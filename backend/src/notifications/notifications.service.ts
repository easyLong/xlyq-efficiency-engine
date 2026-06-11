import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { FeishuService } from '../integrations/feishu/feishu.service';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { RequirementEntity } from '../requirements/entities/requirement.entity';
import { TaskDirectoryEntity } from '../tasks/entities/task-directory.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskResultFileEntity } from '../tasks/entities/task-result-file.entity';
import { UserEntity } from '../users/entities/user.entity';
import { ScanFeishuSyncFailuresDto } from './dto/scan-feishu-sync-failures.dto';
import { ScanResultFileMissingDto } from './dto/scan-result-file-missing.dto';
import { ScanTaskDeadlinesDto } from './dto/scan-task-deadlines.dto';
import { ScanTaskProgressFeedbackDto } from './dto/scan-task-progress-feedback.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SendWorklogRemindersDto } from './dto/send-worklog-reminders.dto';
import { NotificationMessageEntity } from './entities/notification-message.entity';
import { createHmac } from 'node:crypto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationMessageEntity)
    private readonly notificationsRepository: Repository<NotificationMessageEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(TaskResultFileEntity)
    private readonly taskResultFilesRepository: Repository<TaskResultFileEntity>,
    @InjectRepository(WorklogEntity)
    private readonly worklogsRepository: Repository<WorklogEntity>,
    @InjectRepository(FeishuSyncLogEntity)
    private readonly feishuSyncLogsRepository: Repository<FeishuSyncLogEntity>,
    private readonly feishuService: FeishuService,
  ) {}

  findAll(recipientUserId?: string, status?: string) {
    return this.notificationsRepository.find({
      where: {
        ...(recipientUserId ? { recipient_user_id: recipientUserId } : {}),
        ...(status ? { status } : {}),
      },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const message = await this.notificationsRepository.findOne({
      where: { id },
    });
    if (!message) {
      throw new NotFoundException('Notification message not found');
    }
    return message;
  }

  async send(dto: SendNotificationDto) {
    const channels = dto.channels?.length
      ? dto.channels
      : ['in_app', 'feishu_app'];
    const message = this.notificationsRepository.create({
      id: randomUUID(),
      recipient_user_id: dto.recipientUserId ?? null,
      title: dto.title,
      content: dto.content,
      object_type: dto.objectType ?? null,
      object_id: dto.objectId ?? null,
      channels_json: channels,
      delivery_result_json: null,
      status: 'pending',
      sent_at: null,
      read_at: null,
      error_message: null,
    });
    await this.notificationsRepository.save(message);

    const result: Record<string, unknown> = {
      in_app: channels.includes('in_app') ? 'saved' : 'skipped',
    };
    const errors: string[] = [];

    if (channels.includes('feishu_app')) {
      try {
        result.feishu_app = await this.sendFeishuAppMessage(message, {
          actionUrl: dto.actionUrl,
          actionText: dto.actionText,
          actions: dto.actions,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown Feishu app error';
        errors.push(errorMessage);
        result.feishu_app = { status: 'failed', errorMessage };
      }
    }

    if (channels.includes('feishu_bot')) {
      try {
        result.feishu_bot = await this.feishuService.sendBotMessage({
          text: dto.botText ?? `${dto.title}\n${dto.content}`,
          objectType: dto.objectType,
          objectId: dto.objectId,
          feishuObjectType: 'bot',
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown Feishu bot error';
        errors.push(errorMessage);
        result.feishu_bot = { status: 'failed', errorMessage };
      }
    }

    message.delivery_result_json = result;
    message.status = errors.length ? 'partial_failed' : 'sent';
    message.error_message = errors.length ? errors.join('; ') : null;
    message.sent_at = new Date();
    return this.notificationsRepository.save(message);
  }

  async notifyTaskAssignedById(taskId: string, message?: string) {
    const task = await this.tasksRepository.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return this.notifyTaskAssigned(task, message);
  }

  async notifyTaskAssigned(task: TaskEntity, message?: string) {
    if (!task.assignee_user_id) {
      return null;
    }

    return this.sendToUsers([task.assignee_user_id], {
      title: `新任务：${task.task_name}`,
      content:
        message ??
        `你收到一个新任务 ${task.task_no}，请点击下方按钮填写项目资产。`,
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
      actionUrl: this.buildTaskAssetSheetUrl(task),
      actionText: '填写项目资产',
    });
  }

  async notifyTaskWorkspaceProvisioned(
    task: TaskEntity,
    workspace: TaskDirectoryEntity,
  ) {
    if (!workspace.assignee_user_id) {
      return null;
    }

    const directoryUrl =
      workspace.directory_url ??
      (workspace.feishu_folder_token
        ? `https://www.feishu.cn/drive/folder/${workspace.feishu_folder_token}`
        : null);
    const [project, assignee] = await Promise.all([
      this.projectsRepository.findOne({ where: { id: task.project_id } }),
      workspace.assignee_user_id
        ? this.usersRepository.findOne({
            where: { id: workspace.assignee_user_id },
          })
        : Promise.resolve(null),
    ]);

    return this.sendToUsers([workspace.assignee_user_id], {
      title: `新任务已指派：${task.task_name}`,
      content: [
        `**任务**：${task.task_name}`,
        `**所属项目**：${project?.project_name ?? '-'}`,
        `**状态**：${this.taskStatusLabel(task.status)}`,
        `**截止时间**：${this.formatDate(task.planned_end_at)}`,
        `**优先级**：${this.priorityLabel(task.priority)}`,
        `**任务执行人**：${assignee?.display_name ?? '-'}`,
        directoryUrl ? '请点击下方按钮填写项目资产。' : '请在任务详情中填写项目资产。',
      ].join('\n'),
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
      actionUrl: directoryUrl ?? this.buildTaskAssetSheetUrl(task),
      actionText: '填写项目资产',
    });
  }

  async notifyTaskStatusChanged(task: TaskEntity) {
    const recipients = await this.getTaskStakeholders(task);
    if (!recipients.length) {
      return null;
    }

    const statusTitleMap: Record<string, string> = {
      todo: '任务待开始',
      in_progress: '任务进行中',
      blocked: '任务阻塞',
      pending_review: '任务待验收',
      completed: '任务已完成',
    };
    const statusLabel =
      statusTitleMap[task.status] ?? `任务状态更新为 ${task.status}`;

    return this.sendToUsers(recipients, {
      title: `${statusLabel}：${task.task_name}`,
      content: [
        `任务 ${task.task_no} 当前状态：${statusLabel}。`,
        '当前 MVP 以在线资产表中的资产地址数量作为统计口径。',
        task.blocked_reason ? `补充说明：${task.blocked_reason}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
    });
  }

  async notifyTaskReturnedForRevision(task: TaskEntity, reason: string) {
    if (!task.assignee_user_id) {
      return null;
    }

    return this.sendToUsers([task.assignee_user_id], {
      title: `任务需修改：${task.task_name}`,
      content: [
        `任务 ${task.task_no} 验收未通过，需要按反馈修改后重新提交。`,
        `退回原因：${reason}`,
        '请点击下方按钮修改项目资产，完成后重新提交交付。',
      ].join('\n'),
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
      actionUrl: this.buildTaskAssetSheetUrl(task),
      actionText: '继续修改',
    });
  }

  async notifyTaskResultFileSubmitted(
    task: TaskEntity,
    file: TaskResultFileEntity,
  ) {
    const recipients = await this.getTaskStakeholders(task);
    return this.sendToUsers(recipients, {
      title: `资产地址已登记：${task.task_name}`,
      content: `任务 ${task.task_no} 新增资产地址「${file.file_name}」，请及时查看和验收。`,
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
    });
  }

  async notifyRequirementCreated(requirement: RequirementEntity) {
    const ownerUserId = await this.getProjectOwnerUserId(
      requirement.project_id,
    );
    return this.sendToUsers(ownerUserId ? [ownerUserId] : [], {
      title: `新需求待处理：${requirement.title}`,
      content: `需求 ${requirement.requirement_code} 已创建，请补充需求项并确认范围。`,
      objectType: 'requirement',
      objectId: requirement.id,
      channels: ['in_app', 'feishu_app'],
    });
  }

  async notifyRequirementChanged(requirement: RequirementEntity) {
    const ownerUserId = await this.getProjectOwnerUserId(
      requirement.project_id,
    );
    return this.sendToUsers(ownerUserId ? [ownerUserId] : [], {
      title: `需求已变更：${requirement.title}`,
      content: `需求 ${requirement.requirement_code} 已更新，请确认是否影响任务、报价或交付范围。`,
      objectType: 'requirement',
      objectId: requirement.id,
      channels: ['in_app', 'feishu_app'],
    });
  }

  async notifyRequirementItemConfirmed(item: RequirementItemEntity) {
    const projectId = await this.getProjectIdByRequirementId(
      item.requirement_id,
    );
    const ownerUserId = projectId
      ? await this.getProjectOwnerUserId(projectId)
      : null;
    return this.sendToUsers(ownerUserId ? [ownerUserId] : [], {
      title: `需求项已确认：${item.item_title}`,
      content: `需求项 ${item.item_no} 已确认，可以继续拆分任务或进行报价适配。`,
      objectType: 'requirement_item',
      objectId: item.id,
      channels: ['in_app', 'feishu_app'],
    });
  }

  async scanTaskDeadlines(dto: ScanTaskDeadlinesDto) {
    const now = new Date();
    const daysAhead = Number(dto.daysAhead ?? 1);
    const dueBefore = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.status != :completed', { completed: 'completed' })
      .andWhere('task.planned_end_at IS NOT NULL')
      .andWhere('task.planned_end_at <= :dueBefore', { dueBefore });

    if (dto.projectId) {
      qb.andWhere('task.project_id = :projectId', { projectId: dto.projectId });
    }

    const tasks = await qb.orderBy('task.planned_end_at', 'ASC').getMany();
    let notificationCount = 0;

    for (const task of tasks) {
      const overdue = task.planned_end_at
        ? task.planned_end_at.getTime() < now.getTime()
        : false;
      const recipients = await this.getTaskStakeholders(task);
      const messages = await this.sendToUsers(recipients, {
        title: `${overdue ? '任务已逾期' : '任务即将逾期'}：${task.task_name}`,
        content: `任务 ${task.task_no} 计划截止时间为 ${task.planned_end_at?.toISOString() ?? ''}，当前状态 ${task.status}，请及时处理。`,
        objectType: 'task',
        objectId: task.id,
        channels: ['in_app', 'feishu_app'],
      });
      notificationCount += messages.length;
    }

    return {
      scannedTaskCount: tasks.length,
      notificationCount,
    };
  }

  async sendWorklogReminders(dto: SendWorklogRemindersDto) {
    void dto;
    return {
      disabled: true,
      reason: 'Worklog reminders are excluded from MVP notification v1.',
      scannedTaskCount: 0,
      reminderCount: 0,
    };
  }

  async scanTaskProgressFeedback(dto: ScanTaskProgressFeedbackDto) {
    const daysAfterStart = Number(dto.daysAfterStart ?? 2);
    const startedBefore = new Date(
      Date.now() - daysAfterStart * 24 * 60 * 60 * 1000,
    );
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.assignee_user_id IS NOT NULL')
      .andWhere('task.created_at <= :startedBefore', { startedBefore })
      .andWhere('task.status IN (:...statuses)', {
        statuses: ['todo', 'in_progress', 'blocked'],
      });

    if (dto.projectId) {
      qb.andWhere('task.project_id = :projectId', { projectId: dto.projectId });
    }

    const tasks = await qb.orderBy('task.created_at', 'ASC').getMany();
    let notificationCount = 0;
    let skippedDuplicateCount = 0;

    for (const task of tasks) {
      const existing = await this.notificationsRepository.count({
        where: {
          recipient_user_id: task.assignee_user_id!,
          object_type: 'task_progress_feedback',
          object_id: task.id,
        },
      });
      if (existing > 0) {
        skippedDuplicateCount += 1;
        continue;
      }

      const messages = await this.sendToUsers([task.assignee_user_id!], {
        title: `请更新项目资产：${task.task_name}`,
        content: [
          `任务 ${task.task_no} 已开始超过 ${daysAfterStart} 天，请进入项目资产页更新进度或提交交付。`,
        ].join('\n'),
        objectType: 'task_progress_feedback',
        objectId: task.id,
        channels: ['in_app', 'feishu_app'],
        actionUrl: this.buildTaskAssetSheetUrl(task),
        actionText: '填写项目资产',
      });
      notificationCount += messages.length;
    }

    return {
      scannedTaskCount: tasks.length,
      skippedDuplicateCount,
      notificationCount,
    };
  }

  async scanResultFileMissing(dto: ScanResultFileMissingDto) {
    const statuses = (dto.statuses ?? 'pending_review,completed')
      .split(',')
      .map((status) => status.trim())
      .filter(Boolean);

    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.status IN (:...statuses)', { statuses })
      .andWhere('task.assignee_user_id IS NOT NULL');

    if (dto.projectId) {
      qb.andWhere('task.project_id = :projectId', { projectId: dto.projectId });
    }

    const tasks = await qb.orderBy('task.updated_at', 'DESC').getMany();
    let notificationCount = 0;
    let missingTaskCount = 0;

    for (const task of tasks) {
      const fileCount = await this.taskResultFilesRepository.count({
        where: { task_id: task.id },
      });
      if (fileCount > 0) {
        continue;
      }

      missingTaskCount += 1;
      const messages = await this.sendToUsers([task.assignee_user_id!], {
        title: `资产地址待填写：${task.task_name}`,
        content: [
          `任务 ${task.task_no} 当前状态为 ${task.status}，但系统还没有同步到资产地址。`,
          '请进入在线资产表填写资产地址，方便项目验收和结算挂靠。',
        ].join('\n'),
        objectType: 'task',
        objectId: task.id,
        channels: ['in_app', 'feishu_app'],
      });
      notificationCount += messages.length;
    }

    return {
      scannedTaskCount: tasks.length,
      missingTaskCount,
      notificationCount,
    };
  }

  async scanFeishuSyncFailures(dto: ScanFeishuSyncFailuresDto) {
    const hours = Number(dto.hours ?? 24);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const failures = await this.feishuSyncLogsRepository
      .createQueryBuilder('log')
      .where('log.status = :status', { status: 'failed' })
      .andWhere('log.triggered_at >= :since', { since })
      .orderBy('log.triggered_at', 'DESC')
      .getMany();

    if (failures.length === 0) {
      return { failureCount: 0, notificationCount: 0 };
    }

    const admins = await this.usersRepository.find({
      where: { source: 'local', status: 'active' },
      take: 3,
    });
    const messages = await this.sendToUsers(
      admins.map((admin) => admin.id),
      {
        title: '飞书同步失败提醒',
        content: `最近 ${hours} 小时内共有 ${failures.length} 条飞书同步失败记录，请检查同步日志。`,
        objectType: 'feishu_sync_log',
        channels: ['in_app'],
      },
    );

    return {
      failureCount: failures.length,
      notificationCount: messages.length,
    };
  }

  async markRead(id: string) {
    const message = await this.findOne(id);
    message.status = message.status === 'sent' ? 'read' : message.status;
    message.read_at = new Date();
    return this.notificationsRepository.save(message);
  }

  private taskStatusLabel(status: string | null) {
    return (
      {
        todo: '未开始',
        pending: '未开始',
        assigned: '已指派',
        in_progress: '进行中',
        blocked: '受阻',
        pending_review: '待验收',
        completed: '已完成',
        cancelled: '已取消',
        returned: '已退回',
      }[status ?? ''] ??
      status ??
      '-'
    );
  }

  private priorityLabel(priority: string | null) {
    return { high: 'P0', medium: 'P1', low: 'P2' }[priority ?? ''] ?? 'P3';
  }

  private formatDate(value: Date | null) {
    if (!value) {
      return '-';
    }
    return `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, '0')}/${String(value.getDate()).padStart(2, '0')}`;
  }

  private buildTaskProgressFeedbackUrl(task: TaskEntity) {
    const baseUrl = process.env.APP_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const token = this.taskAccessToken(task);
    return `${baseUrl.replace(/\/$/, '')}/task-progress.html?taskId=${task.id}&taskNo=${encodeURIComponent(task.task_no)}&token=${encodeURIComponent(token)}`;
  }

  private buildTaskAssetSheetUrl(task: TaskEntity) {
    const baseUrl = process.env.APP_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const token = this.taskAccessToken(task);
    return `${baseUrl.replace(/\/$/, '')}/asset-sheet.html?taskId=${task.id}&taskNo=${encodeURIComponent(task.task_no)}&token=${encodeURIComponent(token)}`;
  }

  private taskAccessToken(task: TaskEntity) {
    const secret =
      process.env.TASK_ACCESS_TOKEN_SECRET ??
      process.env.APP_SECRET ??
      process.env.DB_PASSWORD ??
      'xlyq-efficiency-engine-local-secret';
    return createHmac('sha256', secret)
      .update(`${task.id}:${task.task_no}`)
      .digest('hex');
  }

  private async sendFeishuAppMessage(
    message: NotificationMessageEntity,
    action?: {
      actionUrl?: string;
      actionText?: string;
      actions?: Array<{
        text: string;
        url?: string;
        type?: string;
        value?: Record<string, unknown>;
      }>;
    },
  ) {
    if (!message.recipient_user_id) {
      return { status: 'skipped', reason: 'recipientUserId is empty' };
    }

    const user = await this.usersRepository.findOne({
      where: { id: message.recipient_user_id },
    });
    if (!user) {
      throw new NotFoundException('Recipient user not found');
    }

    const receiveIdType = user.feishu_open_id ? 'open_id' : 'email';
    const receiveId = user.feishu_open_id ?? user.email;
    if (!receiveId) {
      return {
        status: 'skipped',
        reason: 'recipient has no feishu_open_id or email',
      };
    }

    return this.feishuService.sendAppMessage({
      receiveIdType,
      receiveId,
      title: message.title,
      text: message.content,
      actionUrl: action?.actionUrl,
      actionText: action?.actionText,
      actions: action?.actions,
      objectType: message.object_type ?? undefined,
      objectId: message.object_id ?? undefined,
    });
  }

  private async sendToUsers(
    recipientUserIds: string[],
    dto: Omit<SendNotificationDto, 'recipientUserId'>,
  ) {
    const uniqueRecipientIds = [...new Set(recipientUserIds.filter(Boolean))];
    return Promise.all(
      uniqueRecipientIds.map((recipientUserId) =>
        this.send({
          ...dto,
          recipientUserId,
        }),
      ),
    );
  }

  private async getTaskStakeholders(task: TaskEntity) {
    const recipients: string[] = [];
    if (task.assignee_user_id) {
      recipients.push(task.assignee_user_id);
    }

    const ownerUserId = await this.getProjectOwnerUserId(task.project_id);
    if (ownerUserId) {
      recipients.push(ownerUserId);
    }

    return [...new Set(recipients)];
  }

  private async getProjectOwnerUserId(projectId: string) {
    const project = await this.projectsRepository.findOne({
      where: { id: projectId },
    });
    return project?.owner_user_id ?? null;
  }

  private async getProjectIdByRequirementId(requirementId: string) {
    const row = await this.tasksRepository.manager
      .createQueryBuilder()
      .select('requirement.project_id', 'projectId')
      .from('requirements', 'requirement')
      .where('requirement.id = :requirementId', { requirementId })
      .getRawOne<{ projectId: string }>();
    return row?.projectId ?? null;
  }
}
