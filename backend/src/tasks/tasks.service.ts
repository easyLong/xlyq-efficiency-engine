import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { FeishuService } from '../integrations/feishu/feishu.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ProvisionTaskWorkspaceDto } from './dto/provision-task-workspace.dto';
import { RegisterTaskResultFileDto } from './dto/register-task-result-file.dto';
import { ReturnTaskRevisionDto } from './dto/return-task-revision.dto';
import { SaveLocalAssetSheetDto } from './dto/save-local-asset-sheet.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskDirectoryEntity } from './entities/task-directory.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskResultFileEntity } from './entities/task-result-file.entity';

@Injectable()
export class TasksService {
  private readonly liveAssetSyncTtlMs = 2 * 60 * 1000;
  private readonly liveAssetSyncConcurrency = 5;
  private readonly defaultListLimit = 500;

  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(RequirementItemEntity)
    private readonly requirementItemsRepository: Repository<RequirementItemEntity>,
    @InjectRepository(TaskDirectoryEntity)
    private readonly taskDirectoriesRepository: Repository<TaskDirectoryEntity>,
    @InjectRepository(TaskResultFileEntity)
    private readonly taskResultFilesRepository: Repository<TaskResultFileEntity>,
    @InjectRepository(FeishuSyncLogEntity)
    private readonly feishuSyncLogsRepository: Repository<FeishuSyncLogEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    private readonly feishuService: FeishuService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(projectId?: string, assigneeUserId?: string) {
    const where = {
      ...(projectId ? { project_id: projectId } : {}),
      ...(assigneeUserId ? { assignee_user_id: assigneeUserId } : {}),
    };

    return this.tasksRepository.find({
      where,
      order: { created_at: 'DESC' },
      take: this.defaultListLimit,
    });
  }

  async findOne(id: string) {
    const task = await this.tasksRepository.findOne({ where: { id } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  async board(projectId?: string, liveAssetCount = false, customerId?: string) {
    const tasks = await this.findBoardTasks(projectId, customerId);
    const assetCountByTaskId = await this.countAssetsByTaskIds(
      tasks.map((task) => task.id),
    );
    if (liveAssetCount) {
      await this.refreshOnlineAssetCounts(tasks, assetCountByTaskId);
    }
    const rows = tasks.map((task) => ({
      ...task,
      asset_count: assetCountByTaskId.get(task.id) ?? 0,
    }));

    return {
      todo: rows.filter((task) => task.status === 'todo'),
      in_progress: rows.filter((task) => task.status === 'in_progress'),
      blocked: rows.filter((task) => task.status === 'blocked'),
      pending_review: rows.filter((task) => task.status === 'pending_review'),
      completed: rows.filter((task) => task.status === 'completed'),
    };
  }

  private async findBoardTasks(projectId?: string, customerId?: string) {
    if (!customerId) {
      return this.findAll(projectId);
    }

    const projects = await this.projectsRepository.find({
      select: { id: true },
      where: {
        customer_id: customerId,
        ...(projectId ? { id: projectId } : {}),
      },
    });
    const projectIds = projects.map((project) => project.id);
    if (projectIds.length === 0) {
      return [];
    }

    return this.tasksRepository.find({
      where: { project_id: In(projectIds) },
      order: { created_at: 'DESC' },
      take: this.defaultListLimit,
    });
  }

  private async refreshOnlineAssetCounts(
    tasks: TaskEntity[],
    assetCountByTaskId: Map<string, number>,
  ) {
    if (tasks.length === 0) {
      return;
    }

    const workspaces = await this.taskDirectoriesRepository.find({
      where: { task_id: In(tasks.map((task) => task.id)) },
    });
    const workspaceByTaskId = new Map(
      workspaces.map((workspace) => [workspace.task_id, workspace]),
    );

    const syncableTasks = tasks.filter((task) => {
      const workspace = workspaceByTaskId.get(task.id);
      return (
        workspace?.permission_status === 'sheet_ready' &&
        Boolean(workspace.feishu_folder_token) &&
        !this.isRecentlySynced(workspace.last_synced_at)
      );
    });

    for (const batch of this.chunkArray(
      syncableTasks,
      this.liveAssetSyncConcurrency,
    )) {
      await Promise.all(
        batch.map(async (task) => {
          const workspace = workspaceByTaskId.get(task.id);
          try {
            const result = await this.syncAssetSheet(task.id);
            if (!result.skipped) {
              assetCountByTaskId.set(task.id, result.assetCount ?? 0);
            }
          } catch {
            // Keep the cached DB count if Feishu is temporarily unavailable.
          }
        }),
      );
    }
  }

  private isRecentlySynced(lastSyncedAt: Date | null) {
    if (!lastSyncedAt) {
      return false;
    }
    return Date.now() - lastSyncedAt.getTime() < this.liveAssetSyncTtlMs;
  }

  private chunkArray<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private async countAssetsByTaskIds(taskIds: string[]) {
    if (taskIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.taskResultFilesRepository
      .createQueryBuilder('file')
      .select('file.task_id', 'taskId')
      .addSelect('COUNT(DISTINCT file.file_url)', 'assetCount')
      .where('file.task_id IN (:...taskIds)', { taskIds })
      .andWhere('file.deleted_at IS NULL')
      .groupBy('file.task_id')
      .getRawMany<{ taskId: string; assetCount: string }>();

    return new Map(rows.map((row) => [row.taskId, Number(row.assetCount)]));
  }

  async create(dto: CreateTaskDto) {
    const task = this.tasksRepository.create({
      id: randomUUID(),
      project_id: dto.projectId,
      requirement_item_id: dto.requirementItemId ?? null,
      task_no: await this.nextTaskNo(dto.projectId),
      task_name: dto.taskName,
      description: dto.description ?? null,
      status: 'todo',
      priority: dto.priority ?? 'medium',
      assignee_user_id: dto.assigneeUserId ?? null,
      estimated_hours: dto.estimatedHours ?? null,
      planned_end_at: dto.plannedEndAt ? new Date(dto.plannedEndAt) : null,
      reporter_user_id: null,
      blocked_reason: null,
      progress_percent: 0,
    });

    return this.tasksRepository.save(task);
  }

  private async nextTaskNo(projectId: string) {
    const rows = await this.tasksRepository
      .createQueryBuilder('task')
      .withDeleted()
      .select('task.task_no', 'taskNo')
      .where('task.project_id = :projectId', { projectId })
      .getRawMany<{ taskNo: string }>();
    const maxNo = rows.reduce((max, row) => {
      const match = /^TASK-(\d+)$/.exec(row.taskNo ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `TASK-${String(maxNo + 1).padStart(4, '0')}`;
  }

  async createFromRequirementItem(itemId: string) {
    const item = await this.requirementItemsRepository.findOne({
      where: { id: itemId },
    });
    if (!item) {
      throw new NotFoundException('Requirement item not found');
    }

    const projectRow = await this.requirementItemsRepository
      .createQueryBuilder('ri')
      .innerJoin('requirements', 'r', 'ri.requirement_id = r.id')
      .select('r.project_id', 'projectId')
      .where('ri.id = :itemId', { itemId })
      .getRawOne<{ projectId: string }>();

    if (!projectRow?.projectId) {
      throw new NotFoundException('Project for requirement item not found');
    }

    return this.create({
      projectId: projectRow.projectId,
      requirementItemId: item.id,
      taskName: item.item_title,
      description: item.item_description ?? undefined,
      priority: item.priority ?? undefined,
      estimatedHours: item.estimated_hours ?? undefined,
    });
  }

  async update(id: string, dto: UpdateTaskDto) {
    const task = await this.findOne(id);
    Object.assign(task, {
      task_name: dto.taskName ?? task.task_name,
      description: dto.description ?? task.description,
      status: dto.status ?? task.status,
      priority: dto.priority ?? task.priority,
      assignee_user_id: dto.assigneeUserId ?? task.assignee_user_id,
      planned_end_at: dto.plannedEndAt
        ? new Date(dto.plannedEndAt)
        : task.planned_end_at,
      actual_end_at: dto.actualEndAt
        ? new Date(dto.actualEndAt)
        : task.actual_end_at,
      estimated_hours: dto.estimatedHours ?? task.estimated_hours,
      progress_percent:
        dto.progressPercent !== undefined
          ? Number(dto.progressPercent)
          : task.progress_percent,
      blocked_reason: dto.blockedReason ?? task.blocked_reason,
    });
    return this.tasksRepository.save(task);
  }

  async assign(id: string, dto: AssignTaskDto) {
    const task = await this.update(id, { assigneeUserId: dto.assigneeUserId });
    if (!dto.provisionWorkspace) {
      const notification =
        await this.notificationsService.notifyTaskAssigned(task);
      return {
        task,
        notification,
      };
    }

    const workspaceResult = await this.provisionWorkspace(id, {
      assigneeUserId: dto.assigneeUserId,
      feishuFolderToken: dto.feishuFolderToken,
      directoryUrl: dto.directoryUrl,
    });

    return {
      task,
      workspace: workspaceResult.workspace,
      assignmentNotification: null,
      workspaceNotification: workspaceResult.notification,
    };
  }

  async updateStatus(id: string, dto: UpdateTaskStatusDto) {
    const patch: UpdateTaskDto = {
      status: dto.status,
      blockedReason: dto.blockedReason,
    };
    if (dto.status === 'completed') {
      patch.progressPercent = '100';
      patch.actualEndAt = new Date().toISOString();
    }
    const task = await this.update(id, patch);
    const notification =
      await this.notificationsService.notifyTaskStatusChanged(task);
    return {
      task,
      notification,
    };
  }

  async returnRevision(id: string, dto: ReturnTaskRevisionDto) {
    const task = await this.findOne(id);
    Object.assign(task, {
      status: 'in_progress',
      progress_percent: Number(dto.progressPercent ?? 60),
      blocked_reason: dto.reason,
      actual_end_at: null,
    });
    const saved = await this.tasksRepository.save(task);
    const notification =
      await this.notificationsService.notifyTaskReturnedForRevision(
        saved,
        dto.reason,
      );

    return {
      task: saved,
      notification,
    };
  }

  async aiAssignmentSuggestion(id: string) {
    const task = await this.findOne(id);
    const fallbackAssignee = await this.tasksRepository
      .createQueryBuilder('t')
      .select('t.assignee_user_id', 'assigneeUserId')
      .addSelect('COUNT(*)', 'taskCount')
      .where('t.assignee_user_id IS NOT NULL')
      .groupBy('t.assignee_user_id')
      .orderBy('COUNT(*)', 'ASC')
      .limit(1)
      .getRawOne<{ assigneeUserId: string | null; taskCount: string }>();

    return {
      taskId: task.id,
      currentAssigneeUserId: task.assignee_user_id,
      suggestion: {
        assigneeUserId: fallbackAssignee?.assigneeUserId ?? null,
        reason:
          '基于当前数据量，先按最低已分配任务数给出一个简单建议，后续可替换为真实 AI 评分模型。',
        matchScore: fallbackAssignee?.assigneeUserId ? 72 : 0,
      },
    };
  }

  async getWorkspace(id: string) {
    await this.findOne(id);
    return this.taskDirectoriesRepository.findOne({ where: { task_id: id } });
  }

  async provisionWorkspace(id: string, dto: ProvisionTaskWorkspaceDto) {
    const task = await this.findOne(id);
    const assigneeUserId = dto.assigneeUserId ?? task.assignee_user_id;
    if (!assigneeUserId) {
      throw new BadRequestException(
        'Task must have an assignee before provisioning workspace permission',
      );
    }

    const assetSheet = await this.prepareAssetSheet(task, dto);
    let workspace = await this.taskDirectoriesRepository.findOne({
      where: { task_id: id },
    });

    if (!workspace) {
      workspace = this.taskDirectoriesRepository.create({
        id: randomUUID(),
        task_id: task.id,
        project_id: task.project_id,
        assignee_user_id: assigneeUserId,
        feishu_folder_token:
          assetSheet.spreadsheetToken ?? dto.feishuFolderToken ?? null,
        directory_url: assetSheet.url,
        permission_status: 'pending_sync',
        last_synced_at: null,
      });
    } else {
      Object.assign(workspace, {
        assignee_user_id: assigneeUserId,
        feishu_folder_token:
          assetSheet.spreadsheetToken ??
          dto.feishuFolderToken ??
          workspace.feishu_folder_token,
        directory_url: assetSheet.url ?? workspace.directory_url,
      });
    }

    workspace.permission_status =
      assetSheet.source === 'feishu_sheet'
        ? 'sheet_ready'
        : 'local_sheet_ready';
    workspace.last_synced_at =
      assetSheet.source === 'feishu_sheet' ? null : new Date();
    const saved = await this.taskDirectoriesRepository.save(workspace);

    await this.feishuSyncLogsRepository.save(
      this.feishuSyncLogsRepository.create({
        object_type: 'task',
        object_id: task.id,
        action_type: 'grant_folder_permission',
        feishu_object_type: assetSheet.source,
        feishu_object_id: saved.feishu_folder_token,
        request_payload_json: {
          taskId: task.id,
          assigneeUserId,
          assetSheetUrl: saved.directory_url,
          columns: ['编号', '资产地址'],
          autoNumberFrom: 1,
        },
        response_payload_json: {
          mocked: assetSheet.source === 'local_asset_sheet',
          permissionStatus: saved.permission_status,
          assetSheet,
        },
        status: assetSheet.source === 'feishu_sheet' ? 'success' : 'mock_sent',
        error_code: null,
        error_message: null,
        triggered_at: new Date(),
        finished_at: new Date(),
      }),
    );

    const notification =
      await this.notificationsService.notifyTaskWorkspaceProvisioned(
        task,
        saved,
      );

    return {
      workspace: saved,
      notification,
    };
  }

  private async prepareAssetSheet(
    task: TaskEntity,
    dto: ProvisionTaskWorkspaceDto,
  ) {
    const fallbackUrl = dto.directoryUrl?.includes('/drive/folder/')
      ? this.buildLocalAssetSheetUrl(task)
      : (dto.directoryUrl ?? this.buildLocalAssetSheetUrl(task));
    try {
      const spreadsheet = await this.feishuService.createTaskAssetSpreadsheet({
        title: `${task.task_no} 资产登记表`,
        objectId: task.id,
        folderToken: dto.feishuFolderToken,
      });
      await this.feishuService.grantSpreadsheetEditPermission({
        spreadsheetToken: spreadsheet.spreadsheetToken,
        userId: dto.assigneeUserId ?? task.assignee_user_id!,
        objectId: task.id,
      });
      return {
        source: 'feishu_sheet',
        url: spreadsheet.spreadsheetUrl,
        spreadsheetToken: spreadsheet.spreadsheetToken,
        sheetId: spreadsheet.sheetId,
      };
    } catch (error) {
      return {
        source: 'local_asset_sheet',
        url: fallbackUrl,
        spreadsheetToken: null,
        sheetId: null,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildLocalAssetSheetUrl(task: TaskEntity) {
    const baseUrl = process.env.APP_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    return `${baseUrl.replace(/\/$/, '')}/asset-sheet.html?taskId=${task.id}&taskNo=${encodeURIComponent(task.task_no)}`;
  }

  async syncAssetSheet(id: string) {
    const task = await this.findOne(id);
    const workspace = await this.taskDirectoriesRepository.findOne({
      where: { task_id: id },
    });
    if (!workspace) {
      throw new NotFoundException('Task asset sheet not found');
    }
    if (
      workspace.permission_status !== 'sheet_ready' ||
      !workspace.feishu_folder_token
    ) {
      return {
        task,
        workspace,
        syncedCount: 0,
        skipped: true,
        reason:
          '任务当前使用本地资产表或飞书表格未就绪，无法由服务端读取飞书表格。',
      };
    }

    const assets = this.uniqueAssets(
      await this.feishuService.readAssetSheetRows({
        spreadsheetToken: workspace.feishu_folder_token,
        objectId: task.id,
      }),
    );
    await this.taskResultFilesRepository.softDelete({
      task_id: task.id,
      source: 'feishu_asset_sheet',
    });
    const created: TaskResultFileEntity[] = [];

    for (const asset of assets) {
      const file = this.taskResultFilesRepository.create({
        id: randomUUID(),
        task_id: task.id,
        project_id: task.project_id,
        file_name: `资产-${asset.sequence}`,
        file_url: asset.assetUrl,
        feishu_file_token: null,
        uploaded_by_user_id: task.assignee_user_id,
        source: 'feishu_asset_sheet',
        remark: `来自资产登记表第 ${asset.sequence} 行`,
      });
      created.push(await this.taskResultFilesRepository.save(file));
    }
    const savedTask = await this.markTaskPendingReviewIfAssetsSubmitted(
      task,
      assets.length,
    );
    workspace.last_synced_at = new Date();
    const savedWorkspace = await this.taskDirectoriesRepository.save(workspace);

    return {
      task: savedTask,
      workspace: savedWorkspace,
      assetCount: assets.length,
      syncedCount: created.length,
      created,
    };
  }

  async saveLocalAssetSheet(id: string, dto: SaveLocalAssetSheetDto) {
    const task = await this.findOne(id);
    const assetUrls = Array.from(
      new Set(
        (dto.assets ?? [])
          .map((asset) => asset.assetUrl.trim())
          .filter((assetUrl) => assetUrl.length > 0),
      ),
    );

    await this.taskResultFilesRepository.softDelete({
      task_id: task.id,
      source: 'local_asset_sheet',
    });

    const created: TaskResultFileEntity[] = [];
    for (const [index, assetUrl] of assetUrls.entries()) {
      const file = this.taskResultFilesRepository.create({
        id: randomUUID(),
        task_id: task.id,
        project_id: task.project_id,
        file_name: `资产-${index + 1}`,
        file_url: assetUrl,
        feishu_file_token: null,
        uploaded_by_user_id: task.assignee_user_id,
        source: 'local_asset_sheet',
        remark: `来自本地兜底资产表第 ${index + 1} 行`,
      });
      created.push(await this.taskResultFilesRepository.save(file));
    }
    const savedTask = await this.markTaskPendingReviewIfAssetsSubmitted(
      task,
      created.length,
    );

    return {
      task: savedTask,
      assetCount: created.length,
      syncedCount: created.length,
      created,
    };
  }

  private async markTaskPendingReviewIfAssetsSubmitted(
    task: TaskEntity,
    assetCount: number,
  ) {
    if (
      assetCount <= 0 ||
      task.status === 'completed' ||
      task.status === 'pending_review'
    ) {
      return task;
    }

    task.status = 'pending_review';
    task.progress_percent = Math.max(Number(task.progress_percent ?? 0), 90);
    return this.tasksRepository.save(task);
  }

  private uniqueAssets(assets: Array<{ sequence: number; assetUrl: string }>) {
    const seen = new Set<string>();
    return assets.filter((asset) => {
      if (seen.has(asset.assetUrl)) {
        return false;
      }
      seen.add(asset.assetUrl);
      return true;
    });
  }

  async listResultFiles(id: string) {
    await this.findOne(id);
    return this.taskResultFilesRepository.find({
      where: { task_id: id },
      order: { created_at: 'DESC' },
    });
  }

  async registerResultFile(id: string, dto: RegisterTaskResultFileDto) {
    const task = await this.findOne(id);
    const file = this.taskResultFilesRepository.create({
      id: randomUUID(),
      task_id: task.id,
      project_id: task.project_id,
      file_name: dto.fileName,
      file_url: dto.fileUrl,
      feishu_file_token: dto.feishuFileToken ?? null,
      uploaded_by_user_id: dto.uploadedByUserId ?? task.assignee_user_id,
      source: dto.feishuFileToken ? 'feishu' : 'manual',
      remark: dto.remark ?? null,
    });

    const saved = await this.taskResultFilesRepository.save(file);
    const notification =
      await this.notificationsService.notifyTaskResultFileSubmitted(
        task,
        saved,
      );
    return {
      file: saved,
      notification,
    };
  }
}
