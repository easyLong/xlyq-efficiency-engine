import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ProvisionTaskWorkspaceDto } from './dto/provision-task-workspace.dto';
import { RegisterTaskResultFileDto } from './dto/register-task-result-file.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskDirectoryEntity } from './entities/task-directory.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskResultFileEntity } from './entities/task-result-file.entity';

@Injectable()
export class TasksService {
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
      take: 100,
    });
  }

  async findOne(id: string) {
    const task = await this.tasksRepository.findOne({ where: { id } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  async board(projectId?: string) {
    const tasks = await this.findAll(projectId);
    return {
      todo: tasks.filter((task) => task.status === 'todo'),
      in_progress: tasks.filter((task) => task.status === 'in_progress'),
      blocked: tasks.filter((task) => task.status === 'blocked'),
      pending_review: tasks.filter((task) => task.status === 'pending_review'),
      completed: tasks.filter((task) => task.status === 'completed'),
    };
  }

  async create(dto: CreateTaskDto) {
    const count = await this.tasksRepository.count({
      where: { project_id: dto.projectId },
    });

    const task = this.tasksRepository.create({
      id: randomUUID(),
      project_id: dto.projectId,
      requirement_item_id: dto.requirementItemId ?? null,
      task_no: `TASK-${String(count + 1).padStart(4, '0')}`,
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
    const notification = await this.notificationsService.notifyTaskAssigned(
      task,
    );
    if (!dto.provisionWorkspace) {
      return {
        task,
        notification,
      };
    }

    const workspace = await this.provisionWorkspace(id, {
      assigneeUserId: dto.assigneeUserId,
      feishuFolderToken: dto.feishuFolderToken,
      directoryUrl: dto.directoryUrl,
    });

    return {
      task,
      workspace,
      notification,
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

    let workspace = await this.taskDirectoriesRepository.findOne({
      where: { task_id: id },
    });

    if (!workspace) {
      workspace = this.taskDirectoriesRepository.create({
        id: randomUUID(),
        task_id: task.id,
        project_id: task.project_id,
        assignee_user_id: assigneeUserId,
        feishu_folder_token: dto.feishuFolderToken ?? null,
        directory_url:
          dto.directoryUrl ??
          (dto.feishuFolderToken
            ? `https://www.feishu.cn/drive/folder/${dto.feishuFolderToken}`
            : null),
        permission_status: 'pending_sync',
        last_synced_at: null,
      });
    } else {
      Object.assign(workspace, {
        assignee_user_id: assigneeUserId,
        feishu_folder_token:
          dto.feishuFolderToken ?? workspace.feishu_folder_token,
        directory_url: dto.directoryUrl ?? workspace.directory_url,
      });
    }

    workspace.permission_status = 'mock_granted';
    workspace.last_synced_at = new Date();
    const saved = await this.taskDirectoriesRepository.save(workspace);

    await this.feishuSyncLogsRepository.save(
      this.feishuSyncLogsRepository.create({
        object_type: 'task',
        object_id: task.id,
        action_type: 'grant_folder_permission',
        feishu_object_type: 'folder',
        feishu_object_id: saved.feishu_folder_token,
        request_payload_json: {
          taskId: task.id,
          assigneeUserId,
          directoryUrl: saved.directory_url,
        },
        response_payload_json: {
          mocked: true,
          permissionStatus: saved.permission_status,
        },
        status: 'mock_sent',
        error_code: null,
        error_message: null,
        triggered_at: new Date(),
        finished_at: new Date(),
      }),
    );

    return saved;
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

    return this.taskResultFilesRepository.save(file);
  }
}
