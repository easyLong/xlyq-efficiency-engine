import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { extname, join } from 'node:path';
import { DataSource, In, Repository } from 'typeorm';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { FeishuService } from '../integrations/feishu/feishu.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { RequirementEntity } from '../requirements/entities/requirement.entity';
import { UserEntity } from '../users/entities/user.entity';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ProvisionTaskWorkspaceDto } from './dto/provision-task-workspace.dto';
import { RegisterTaskResultFileDto } from './dto/register-task-result-file.dto';
import { ReturnTaskRevisionDto } from './dto/return-task-revision.dto';
import { SaveLocalAssetSheetDto } from './dto/save-local-asset-sheet.dto';
import { SubmitTaskProgressFeedbackDto } from './dto/submit-task-progress-feedback.dto';
import { UploadLocalAssetImageDto } from './dto/upload-local-asset-image.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskDirectoryEntity } from './entities/task-directory.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskResultFileEntity } from './entities/task-result-file.entity';
import { TaskStatusHistoryEntity } from './entities/task-status-history.entity';
import {
  assertTaskStatusTransition,
  TaskStatus,
  taskStatusLabel,
} from './task-status';
import { buildTaskWorkflowSnapshot } from './task-workflow';

@Injectable()
export class TasksService implements OnModuleInit {
  private readonly liveAssetSyncTtlMs = 2 * 60 * 1000;
  private readonly liveAssetSyncConcurrency = 5;
  private readonly defaultListLimit = 500;
  private readonly maxLocalImageCount = 80;
  private readonly maxLocalAssetCount = 200;

  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(RequirementItemEntity)
    private readonly requirementItemsRepository: Repository<RequirementItemEntity>,
    @InjectRepository(RequirementEntity)
    private readonly requirementsRepository: Repository<RequirementEntity>,
    @InjectRepository(TaskDirectoryEntity)
    private readonly taskDirectoriesRepository: Repository<TaskDirectoryEntity>,
    @InjectRepository(TaskResultFileEntity)
    private readonly taskResultFilesRepository: Repository<TaskResultFileEntity>,
    @InjectRepository(TaskStatusHistoryEntity)
    private readonly taskStatusHistoriesRepository: Repository<TaskStatusHistoryEntity>,
    @InjectRepository(FeishuSyncLogEntity)
    private readonly feishuSyncLogsRepository: Repository<FeishuSyncLogEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly feishuService: FeishuService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.ensureTaskStatusHistoryTable();
  }

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

  async listStatusHistory(id: string) {
    await this.findOne(id);
    return this.taskStatusHistoriesRepository.find({
      where: { task_id: id },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async getWorkflow(id: string) {
    const task = await this.findOne(id);
    const [workspace, assetCount, statusHistory] = await Promise.all([
      this.taskDirectoriesRepository.findOne({ where: { task_id: id } }),
      this.countAssetsByTaskIds([id]).then((counts) => counts.get(id) ?? 0),
      this.taskStatusHistoriesRepository.find({
        where: { task_id: id },
        order: { created_at: 'DESC' },
        take: 10,
      }),
    ]);

    return {
      task,
      workflow: buildTaskWorkflowSnapshot(task),
      workspace: workspace
        ? {
            ...workspace,
            directory_url: this.ensureSignedLocalAssetSheetUrl(
              task,
              workspace.directory_url,
            ),
          }
        : null,
      assetCount,
      statusHistory,
    };
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
      workflow: buildTaskWorkflowSnapshot(task),
    }));

    return {
      todo: rows.filter((task) =>
        [TaskStatus.Todo, TaskStatus.Pending, TaskStatus.Assigned].includes(
          task.status as TaskStatus,
        ),
      ),
      in_progress: rows.filter((task) => task.status === TaskStatus.InProgress),
      blocked: rows.filter((task) => task.status === TaskStatus.Blocked),
      pending_review: rows.filter(
        (task) => task.status === TaskStatus.PendingReview,
      ),
      completed: rows.filter((task) => task.status === TaskStatus.Completed),
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
      .andWhere('file.source IN (:...billableSources)', {
        billableSources: this.billableAssetSources(),
      })
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
      status: TaskStatus.Todo,
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
    const fromStatus = task.status;
    const nextStatus = dto.status
      ? assertTaskStatusTransition(task.status, dto.status)
      : task.status;
    Object.assign(task, {
      task_name: dto.taskName ?? task.task_name,
      description: dto.description ?? task.description,
      status: nextStatus,
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
    const saved = await this.tasksRepository.save(task);
    await this.recordTaskStatusHistory(
      saved,
      fromStatus,
      saved.status,
      'manual_update',
      dto.blockedReason,
    );
    return saved;
  }

  async assign(id: string, dto: AssignTaskDto) {
    const current = await this.findOne(id);
    const shouldMarkAssigned = [
      TaskStatus.Todo,
      TaskStatus.Pending,
      TaskStatus.Returned,
    ].includes(current.status as TaskStatus);
    const task = await this.update(id, {
      assigneeUserId: dto.assigneeUserId,
      status: shouldMarkAssigned ? TaskStatus.Assigned : undefined,
    });
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
    if (dto.status === TaskStatus.Completed) {
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
    const fromStatus = task.status;
    Object.assign(task, {
      status: assertTaskStatusTransition(task.status, TaskStatus.InProgress),
      progress_percent: Number(dto.progressPercent ?? 60),
      blocked_reason: dto.reason,
      actual_end_at: null,
    });
    const saved = await this.tasksRepository.save(task);
    await this.recordTaskStatusHistory(
      saved,
      fromStatus,
      saved.status,
      'return_revision',
      dto.reason,
    );
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
    const task = await this.findOne(id);
    const workspace = await this.taskDirectoriesRepository.findOne({
      where: { task_id: id },
    });
    if (!workspace) {
      return null;
    }
    return {
      ...workspace,
      directory_url: this.ensureSignedLocalAssetSheetUrl(
        task,
        workspace.directory_url,
      ),
    };
  }

  async getAssetSheetContext(id: string, token?: string, reopen = false) {
    let task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    task = await this.markTaskInProgressWhenAssetOpened(task, reopen);
    const [project, requirementItem, assignee, workspace, files] =
      await Promise.all([
        this.projectsRepository.findOne({ where: { id: task.project_id } }),
        task.requirement_item_id
          ? this.requirementItemsRepository.findOne({
              where: { id: task.requirement_item_id },
            })
          : Promise.resolve(null),
        task.assignee_user_id
          ? this.usersRepository.findOne({
              where: { id: task.assignee_user_id },
            })
          : Promise.resolve(null),
        this.taskDirectoriesRepository.findOne({ where: { task_id: id } }),
        this.listResultFiles(id),
      ]);
    const requirement = requirementItem
      ? await this.requirementsRepository.findOne({
          where: { id: requirementItem.requirement_id },
        })
      : null;

    const localImages = files.filter(
      (file) => file.source === 'local_asset_sheet_image',
    );
    const localLink = files.find(
      (file) => file.source === 'local_asset_sheet_link',
    );
    const legacyLocalAssets = files.filter(
      (file) => file.source === 'local_asset_sheet',
    );

    return {
      task,
      project,
      requirement,
      requirementItem,
      assignee: assignee
        ? {
            id: assignee.id,
            username: assignee.username,
            display_name: assignee.display_name,
            avatar_url: assignee.avatar_url,
          }
        : null,
      workspace,
      files,
      workflow: buildTaskWorkflowSnapshot(task),
      delivery: {
        imageUrls: (localImages.length ? localImages : legacyLocalAssets).map(
          (file) => file.file_url,
        ),
        linkUrl: localLink?.file_url ?? '',
      },
    };
  }

  async getProgressFeedbackContext(id: string, token?: string) {
    const task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    const [project, requirementItem, assignee, workspace] = await Promise.all([
      this.projectsRepository.findOne({ where: { id: task.project_id } }),
      task.requirement_item_id
        ? this.requirementItemsRepository.findOne({
            where: { id: task.requirement_item_id },
          })
        : Promise.resolve(null),
      task.assignee_user_id
        ? this.usersRepository.findOne({ where: { id: task.assignee_user_id } })
        : Promise.resolve(null),
      this.taskDirectoriesRepository.findOne({ where: { task_id: id } }),
    ]);

    return {
      task,
      project,
      requirementItem,
      assignee: assignee
        ? {
            id: assignee.id,
            username: assignee.username,
            display_name: assignee.display_name,
            avatar_url: assignee.avatar_url,
          }
        : null,
      workspace,
      statusLabel: this.publicTaskStatusLabel(task.status),
      workflow: buildTaskWorkflowSnapshot(task),
      assetSheetUrl:
        workspace?.directory_url ?? this.buildLocalAssetSheetUrl(task),
    };
  }

  async submitProgressFeedback(
    id: string,
    dto: SubmitTaskProgressFeedbackDto,
    token?: string,
  ) {
    const task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    const fromStatus = task.status;
    task.status = assertTaskStatusTransition(task.status, dto.status);
    if (dto.status === TaskStatus.InProgress) {
      task.progress_percent = Math.max(Number(task.progress_percent ?? 0), 30);
      task.actual_end_at = null;
    }
    if (dto.status === TaskStatus.Completed) {
      task.progress_percent = 100;
      task.actual_end_at = new Date();
    }
    const saved = await this.tasksRepository.save(task);
    await this.recordTaskStatusHistory(
      saved,
      fromStatus,
      saved.status,
      'public_progress_feedback',
      null,
    );
    return {
      task: saved,
      statusLabel: this.publicTaskStatusLabel(saved.status),
      workflow: buildTaskWorkflowSnapshot(saved),
      assetSheetUrl: this.buildLocalAssetSheetUrl(saved),
    };
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
          columns: ['编号', '资产地址', '图片地址（可多张）', '交付链接'],
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
    const token = this.assetSheetToken(task);
    return `${baseUrl.replace(/\/$/, '')}/asset-sheet.html?taskId=${task.id}&taskNo=${encodeURIComponent(task.task_no)}&token=${encodeURIComponent(token)}`;
  }

  private ensureSignedLocalAssetSheetUrl(task: TaskEntity, url: string | null) {
    if (!url || !url.includes('/asset-sheet.html')) {
      return url;
    }
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('taskId', task.id);
      parsed.searchParams.set('taskNo', task.task_no);
      parsed.searchParams.set('token', this.assetSheetToken(task));
      return parsed.toString();
    } catch {
      return this.buildLocalAssetSheetUrl(task);
    }
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
      source: In([
        'feishu_asset_sheet',
        'feishu_asset_sheet_image',
        'feishu_asset_sheet_link',
      ]),
    });
    const created: TaskResultFileEntity[] = [];

    for (const asset of assets) {
      if (asset.assetUrl) {
        created.push(
          await this.createTaskResultFile(task, {
            fileName: `资产-${asset.sequence}`,
            fileUrl: asset.assetUrl,
            source: 'feishu_asset_sheet',
            remark: `来自资产登记表第 ${asset.sequence} 行`,
          }),
        );
      }
      for (const [imageIndex, imageUrl] of (asset.imageUrls ?? []).entries()) {
        created.push(
          await this.createTaskResultFile(task, {
            fileName: `图片-${asset.sequence}-${imageIndex + 1}`,
            fileUrl: imageUrl,
            source: 'feishu_asset_sheet_image',
            remark: `来自资产登记表第 ${asset.sequence} 行图片区`,
          }),
        );
      }
      if (asset.linkUrl) {
        created.push(
          await this.createTaskResultFile(task, {
            fileName: `交付链接-${asset.sequence}`,
            fileUrl: asset.linkUrl,
            source: 'feishu_asset_sheet_link',
            remark: `来自资产登记表第 ${asset.sequence} 行单链接区`,
          }),
        );
      }
    }
    const savedTask = await this.markTaskPendingReviewIfAssetsSubmitted(
      task,
      this.billableAssetCount(created),
    );
    workspace.last_synced_at = new Date();
    const savedWorkspace = await this.taskDirectoriesRepository.save(workspace);

    return {
      task: savedTask,
      workflow: buildTaskWorkflowSnapshot(savedTask),
      workspace: savedWorkspace,
      assetCount: this.billableAssetCount(created),
      syncedCount: created.length,
      created,
    };
  }

  async saveLocalAssetSheet(
    id: string,
    dto: SaveLocalAssetSheetDto,
    token?: string,
  ) {
    const task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    const fromStatus = task.status;
    const assetUrls = this.uniqueTextValues(
      new Set(
        (dto.assets ?? [])
          .map((asset) => asset.assetUrl.trim())
          .filter((assetUrl) => assetUrl.length > 0),
      ),
    );
    const imageUrls = this.uniqueTextValues(dto.imageUrls ?? []);
    const linkUrl = (dto.linkUrl ?? '').trim();
    this.assertDeliveryUrls(assetUrls, imageUrls, linkUrl);
    if (!assetUrls.length && !imageUrls.length && !linkUrl) {
      throw new BadRequestException(
        '请至少上传一张图片或填写一个交付链接后再提交交付',
      );
    }

    const { created, savedTask } = await this.dataSource.transaction(
      async (manager) => {
        const fileRepository = manager.getRepository(TaskResultFileEntity);
        const taskRepository = manager.getRepository(TaskEntity);
        await fileRepository.softDelete({
          task_id: task.id,
          source: In([
            'local_asset_sheet',
            'local_asset_sheet_image',
            'local_asset_sheet_link',
          ]),
        });

        const created: TaskResultFileEntity[] = [];
        const createFile = async (input: {
          fileName: string;
          fileUrl: string;
          source: string;
          remark: string;
        }) => {
          const file = fileRepository.create({
            id: randomUUID(),
            task_id: task.id,
            project_id: task.project_id,
            file_name: input.fileName,
            file_url: input.fileUrl,
            feishu_file_token: null,
            uploaded_by_user_id: task.assignee_user_id,
            source: input.source,
            remark: input.remark,
          });
          created.push(await fileRepository.save(file));
        };

        for (const [index, assetUrl] of assetUrls.entries()) {
          await createFile({
            fileName: `资产-${index + 1}`,
            fileUrl: assetUrl,
            source: 'local_asset_sheet',
            remark: `来自本地兜底资产表第 ${index + 1} 行`,
          });
        }
        for (const [index, imageUrl] of imageUrls.entries()) {
          await createFile({
            fileName: `图片-${index + 1}`,
            fileUrl: imageUrl,
            source: 'local_asset_sheet_image',
            remark: `来自本地任务通知页图片区第 ${index + 1} 张`,
          });
        }
        if (linkUrl) {
          await createFile({
            fileName: '交付链接',
            fileUrl: linkUrl,
            source: 'local_asset_sheet_link',
            remark: '来自本地任务通知页单链接区',
          });
        }

        const assetCount = this.billableAssetCount(created);
        let savedTask = task;
        if (
          assetCount > 0 &&
          task.status !== TaskStatus.Completed &&
          task.status !== TaskStatus.PendingReview
        ) {
          task.status = assertTaskStatusTransition(
            task.status,
            TaskStatus.PendingReview,
          );
          task.progress_percent = Math.max(
            Number(task.progress_percent ?? 0),
            90,
          );
          savedTask = await taskRepository.save(task);
        }
        return { created, savedTask };
      },
    );
    await this.recordTaskStatusHistory(
      savedTask,
      fromStatus,
      savedTask.status,
      'local_asset_submitted',
      null,
    );

    return {
      task: savedTask,
      workflow: buildTaskWorkflowSnapshot(savedTask),
      assetCount: this.billableAssetCount(created),
      syncedCount: created.length,
      created,
    };
  }

  async uploadLocalAssetImage(
    id: string,
    dto: UploadLocalAssetImageDto,
    token?: string,
  ) {
    const task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    await this.assertUploadCapacity(task.id);
    const match =
      /^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/=]+)$/i.exec(
        dto.dataUrl ?? '',
      );
    if (!match) {
      throw new BadRequestException(
        'Only png, jpg, webp or gif images are supported',
      );
    }

    const ext =
      match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length <= 0) {
      throw new BadRequestException('Uploaded image is empty');
    }
    if (bytes.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Uploaded image must be smaller than 8MB');
    }

    const uploadDir = join(
      process.cwd(),
      'public',
      'uploads',
      'task-assets',
      task.id,
    );
    await mkdir(uploadDir, { recursive: true });
    const safeBaseName = this.safeFileBaseName(dto.fileName) || 'image';
    const fileName = `${safeBaseName}-${randomUUID().slice(0, 8)}.${ext}`;
    const filePath = join(uploadDir, fileName);
    await writeFile(filePath, bytes);

    return {
      taskId: task.id,
      imageUrl: `/uploads/task-assets/${task.id}/${fileName}`,
      fileName,
      size: bytes.length,
    };
  }

  private uniqueTextValues(values: string[] | Set<string>) {
    return Array.from(values)
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  private assertDeliveryUrls(
    assetUrls: string[],
    imageUrls: string[],
    linkUrl: string,
  ) {
    if (assetUrls.length > this.maxLocalAssetCount) {
      throw new BadRequestException(
        `Asset URL count cannot exceed ${this.maxLocalAssetCount}`,
      );
    }
    if (imageUrls.length > this.maxLocalImageCount) {
      throw new BadRequestException(
        `Image URL count cannot exceed ${this.maxLocalImageCount}`,
      );
    }
    const allUrls = [...assetUrls, ...imageUrls, linkUrl].filter(Boolean);
    for (const url of allUrls) {
      if (url.length > 500) {
        throw new BadRequestException(
          'Delivery URL cannot exceed 500 characters',
        );
      }
      if (!this.isAllowedDeliveryUrl(url)) {
        throw new BadRequestException(
          'Delivery URL must be http(s) or a local uploads path',
        );
      }
    }
  }

  private isAllowedDeliveryUrl(url: string) {
    return /^https?:\/\//i.test(url) || url.startsWith('/uploads/task-assets/');
  }

  private async assertUploadCapacity(taskId: string) {
    const count = await this.taskResultFilesRepository.count({
      where: {
        task_id: taskId,
        source: In(['local_asset_sheet_image', 'local_asset_sheet']),
      },
    });
    if (count >= this.maxLocalImageCount) {
      throw new BadRequestException(
        `Image asset count cannot exceed ${this.maxLocalImageCount}`,
      );
    }
  }

  private billableAssetSources() {
    return [
      'local_asset_sheet',
      'local_asset_sheet_image',
      'feishu_asset_sheet',
      'feishu_asset_sheet_image',
      'manual',
      'feishu',
    ];
  }

  private billableAssetCount(files: TaskResultFileEntity[]) {
    const sources = new Set(this.billableAssetSources());
    return new Set(
      files
        .filter((file) => sources.has(file.source))
        .map((file) => file.file_url)
        .filter(Boolean),
    ).size;
  }

  private assetSheetToken(task: TaskEntity) {
    const secret =
      process.env.TASK_ACCESS_TOKEN_SECRET ??
      process.env.APP_SECRET ??
      process.env.DB_PASSWORD ??
      'xlyq-efficiency-engine-local-secret';
    return createHmac('sha256', secret)
      .update(`${task.id}:${task.task_no}`)
      .digest('hex');
  }

  private async markTaskInProgressWhenAssetOpened(
    task: TaskEntity,
    reopen = false,
  ) {
    if (
      [
        TaskStatus.Todo,
        TaskStatus.Pending,
        TaskStatus.Assigned,
        TaskStatus.Returned,
        ...(reopen ? [TaskStatus.Completed] : []),
      ].includes(task.status as TaskStatus) &&
      task.assignee_user_id
    ) {
      const fromStatus = task.status;
      task.status = assertTaskStatusTransition(
        task.status,
        TaskStatus.InProgress,
      );
      task.progress_percent = Math.max(Number(task.progress_percent ?? 0), 30);
      task.actual_end_at = null;
      const saved = await this.tasksRepository.save(task);
      await this.recordTaskStatusHistory(
        saved,
        fromStatus,
        saved.status,
        'asset_sheet_opened',
        reopen ? 'reopen' : null,
      );
      return saved;
    }
    return task;
  }

  private publicTaskStatusLabel(status: string | null) {
    return taskStatusLabel(status);
  }

  private assertAssetSheetAccess(task: TaskEntity, token?: string) {
    const expected = this.assetSheetToken(task);
    if (!token || token.length !== expected.length) {
      throw new UnauthorizedException('Invalid task access token');
    }
    const ok = timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) {
      throw new UnauthorizedException('Invalid task access token');
    }
  }

  private safeFileBaseName(value?: string) {
    const raw = (value ?? '').trim();
    const withoutExt = raw
      ? raw.slice(0, raw.length - extname(raw).length)
      : '';
    return withoutExt
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
  }

  private async createTaskResultFile(
    task: TaskEntity,
    input: {
      fileName: string;
      fileUrl: string;
      source: string;
      remark: string;
    },
  ) {
    const file = this.taskResultFilesRepository.create({
      id: randomUUID(),
      task_id: task.id,
      project_id: task.project_id,
      file_name: input.fileName,
      file_url: input.fileUrl,
      feishu_file_token: null,
      uploaded_by_user_id: task.assignee_user_id,
      source: input.source,
      remark: input.remark,
    });
    return this.taskResultFilesRepository.save(file);
  }

  private async markTaskPendingReviewIfAssetsSubmitted(
    task: TaskEntity,
    assetCount: number,
  ) {
    if (
      assetCount <= 0 ||
      task.status === TaskStatus.Completed ||
      task.status === TaskStatus.PendingReview
    ) {
      return task;
    }

    const fromStatus = task.status;
    task.status = assertTaskStatusTransition(
      task.status,
      TaskStatus.PendingReview,
    );
    task.progress_percent = Math.max(Number(task.progress_percent ?? 0), 90);
    const saved = await this.tasksRepository.save(task);
    await this.recordTaskStatusHistory(
      saved,
      fromStatus,
      saved.status,
      'asset_submitted',
      null,
    );
    return saved;
  }

  private async recordTaskStatusHistory(
    task: TaskEntity,
    fromStatus: string,
    toStatus: string,
    triggerSource: string,
    remark: string | null | undefined,
  ) {
    if (fromStatus === toStatus) {
      return null;
    }
    return this.taskStatusHistoriesRepository.save(
      this.taskStatusHistoriesRepository.create({
        task_id: task.id,
        from_status: fromStatus,
        to_status: toStatus,
        trigger_source: triggerSource,
        remark: remark ?? null,
      }),
    );
  }

  private async ensureTaskStatusHistoryTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS task_status_histories (
        id CHAR(36) NOT NULL,
        task_id CHAR(36) NOT NULL,
        from_status VARCHAR(32) NOT NULL,
        to_status VARCHAR(32) NOT NULL,
        trigger_source VARCHAR(64) NOT NULL,
        remark VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_task_status_histories_task_created (task_id, created_at),
        CONSTRAINT fk_task_status_histories_task FOREIGN KEY (task_id) REFERENCES tasks (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务状态历史表'
    `);
  }

  private uniqueAssets(
    assets: Array<{
      sequence: number;
      assetUrl: string;
      imageUrls?: string[];
      linkUrl?: string;
    }>,
  ) {
    const seen = new Set<string>();
    return assets.filter((asset) => {
      const urls = [
        asset.assetUrl,
        ...(asset.imageUrls ?? []),
        asset.linkUrl,
      ].filter((url): url is string => Boolean(url));
      const uniqueUrls = urls.filter((url) => !seen.has(url));
      uniqueUrls.forEach((url) => seen.add(url));
      asset.imageUrls = (asset.imageUrls ?? []).filter((url) =>
        uniqueUrls.includes(url),
      );
      if (asset.linkUrl && !uniqueUrls.includes(asset.linkUrl)) {
        asset.linkUrl = '';
      }
      if (asset.assetUrl && !uniqueUrls.includes(asset.assetUrl)) {
        asset.assetUrl = '';
      }
      return uniqueUrls.length > 0;
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
