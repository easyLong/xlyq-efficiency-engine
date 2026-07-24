import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID } from 'node:crypto';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import {
  addWorkflowHandoffToAppUrl,
  buildAppPublicUrl,
  rebaseAppPublicUrl,
} from '../common/app-public-url';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { FeishuService } from '../integrations/feishu/feishu.service';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { RequirementEntity } from '../requirements/entities/requirement.entity';
import { TaskDirectoryEntity } from '../tasks/entities/task-directory.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskResultFileEntity } from '../tasks/entities/task-result-file.entity';
import { TaskStatus, taskStatusLabel } from '../tasks/task-status';
import { UserEntity } from '../users/entities/user.entity';
import { ScanFeishuSyncFailuresDto } from './dto/scan-feishu-sync-failures.dto';
import { ScanResultFileMissingDto } from './dto/scan-result-file-missing.dto';
import { ScanTaskDeadlinesDto } from './dto/scan-task-deadlines.dto';
import { ScanTaskProgressFeedbackDto } from './dto/scan-task-progress-feedback.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SendWorklogRemindersDto } from './dto/send-worklog-reminders.dto';
import { NotificationMessageEntity } from './entities/notification-message.entity';

type SendNotificationOptions = {
  idempotencyKey?: string;
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  private notificationSchemaPromise: Promise<void> | null = null;

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
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureNotificationSchema();
  }

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

  async send(dto: SendNotificationDto, options: SendNotificationOptions = {}) {
    const idempotencyKey = this.normalizeIdempotencyKey(options.idempotencyKey);
    if (idempotencyKey) {
      await this.ensureNotificationSchema();
    }
    const channels = dto.channels?.length
      ? dto.channels
      : ['in_app', 'feishu_app'];
    let message = this.notificationsRepository.create({
      id: randomUUID(),
      recipient_user_id: dto.recipientUserId ?? null,
      idempotency_key: idempotencyKey,
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
    try {
      message = await this.notificationsRepository.save(message);
    } catch (error) {
      if (!idempotencyKey || !this.isDuplicateEntryError(error)) {
        throw error;
      }
      const existing = await this.notificationsRepository.findOne({
        where: { idempotency_key: idempotencyKey },
        withDeleted: true,
      });
      if (!existing) {
        throw error;
      }
      return existing;
    }

    const result: Record<string, unknown> = {
      in_app: channels.includes('in_app') ? 'saved' : 'skipped',
    };
    if (channels.includes('feishu_app')) {
      try {
        result.feishu_app = await this.sendFeishuAppMessage(message, {
          actionUrl: this.recipientAppUrl(
            dto.actionUrl,
            message.recipient_user_id,
          ),
          actionText: dto.actionText,
          actions: dto.actions?.map((action) => ({
            ...action,
            url: this.recipientAppUrl(action.url, message.recipient_user_id),
          })),
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown Feishu app error';
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
        result.feishu_bot = { status: 'failed', errorMessage };
      }
    }

    const deliveryErrors = this.collectDeliveryErrors(result);
    message.delivery_result_json = result;
    message.status = deliveryErrors.length ? 'partial_failed' : 'sent';
    message.error_message = deliveryErrors.length
      ? deliveryErrors.join('; ')
      : null;
    message.sent_at = new Date();
    return this.notificationsRepository.save(message);
  }

  private normalizeIdempotencyKey(value: string | null | undefined) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return null;
    }
    if (normalized.length > 191) {
      throw new Error('Notification idempotency key exceeds 191 characters');
    }
    return normalized;
  }

  private isDuplicateEntryError(error: unknown) {
    const candidate = error as {
      code?: unknown;
      errno?: unknown;
      driverError?: { code?: unknown; errno?: unknown };
    };
    return (
      candidate?.code === 'ER_DUP_ENTRY' ||
      candidate?.driverError?.code === 'ER_DUP_ENTRY' ||
      Number(candidate?.errno) === 1062 ||
      Number(candidate?.driverError?.errno) === 1062
    );
  }

  private ensureNotificationSchema() {
    if (!this.notificationSchemaPromise) {
      this.notificationSchemaPromise = this.prepareNotificationSchema().catch(
        (error) => {
          this.notificationSchemaPromise = null;
          throw error;
        },
      );
    }
    return this.notificationSchemaPromise;
  }

  private async prepareNotificationSchema() {
    const columns = (await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'notification_messages'
          AND column_name = 'idempotency_key'
      `,
    )) as Array<{ count: number | string }>;
    if (Number(columns?.[0]?.count ?? 0) === 0) {
      try {
        await this.dataSource.query(`
          ALTER TABLE notification_messages
          ADD COLUMN idempotency_key VARCHAR(191) NULL AFTER recipient_user_id
        `);
      } catch (error) {
        if (!this.isMysqlSchemaRace(error, 'ER_DUP_FIELDNAME', 1060)) {
          throw error;
        }
      }
    }

    const indexes = (await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'notification_messages'
          AND index_name = 'uq_notification_messages_idempotency_key'
      `,
    )) as Array<{ count: number | string }>;
    if (Number(indexes?.[0]?.count ?? 0) === 0) {
      try {
        await this.dataSource.query(`
          CREATE UNIQUE INDEX uq_notification_messages_idempotency_key
          ON notification_messages (idempotency_key)
        `);
      } catch (error) {
        if (!this.isMysqlSchemaRace(error, 'ER_DUP_KEYNAME', 1061)) {
          throw error;
        }
      }
    }
  }

  private isMysqlSchemaRace(error: unknown, code: string, errno: number) {
    const candidate = error as {
      code?: unknown;
      errno?: unknown;
      driverError?: { code?: unknown; errno?: unknown };
    };
    return (
      candidate?.code === code ||
      candidate?.driverError?.code === code ||
      Number(candidate?.errno) === errno ||
      Number(candidate?.driverError?.errno) === errno
    );
  }

  private collectDeliveryErrors(result: Record<string, unknown>) {
    return Object.entries(result)
      .map(([channel, value]) => {
        if (!value || typeof value !== 'object') {
          return null;
        }
        const delivery = value as {
          status?: unknown;
          errorMessage?: unknown;
          error_message?: unknown;
          message?: unknown;
        };
        if (
          delivery.status !== 'failed' &&
          delivery.status !== 'partial_failed'
        ) {
          return null;
        }
        const message =
          delivery.errorMessage ?? delivery.error_message ?? delivery.message;
        return typeof message === 'string' && message.trim()
          ? `${channel}: ${message}`
          : `${channel}: delivery failed`;
      })
      .filter((message): message is string => Boolean(message));
  }

  private recipientAppUrl(
    actionUrl: string | undefined,
    recipientUserId: string | null,
  ) {
    if (!actionUrl || !recipientUserId) {
      return actionUrl;
    }
    return addWorkflowHandoffToAppUrl(actionUrl, recipientUserId);
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
        `你收到一个新任务 ${task.task_no}，请进入交付登记页上传图片资产，并补充合作链接。`,
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
      actionUrl: this.buildTaskAssetSheetUrl(task),
      actionText: '登记交付资产',
    });
  }

  async notifyTaskWorkspaceProvisioned(
    task: TaskEntity,
    workspace: TaskDirectoryEntity,
  ) {
    if (!workspace.assignee_user_id) {
      return null;
    }

    const directoryUrl = this.withAssetSheetStart(
      workspace.directory_url ??
        (workspace.feishu_folder_token
          ? `https://www.feishu.cn/drive/folder/${workspace.feishu_folder_token}`
          : null),
    );
    const [project, assignee] = await Promise.all([
      this.projectsRepository.findOne({ where: { id: task.project_id } }),
      workspace.assignee_user_id
        ? this.usersRepository.findOne({
            where: { id: workspace.assignee_user_id },
          })
        : Promise.resolve(null),
    ]);
    const fundPlatformLabel = await this.taskFundPlatformLabel(task, project);
    const taskDetail = await this.taskDetailForNotification(task);

    return this.sendToUsers([workspace.assignee_user_id], {
      title: `新任务已指派：${task.task_name}`,
      content: [
        `**任务**：${task.task_name}`,
        ...(taskDetail ? [`**任务详情**：${taskDetail}`] : []),
        `**基金平台**：${fundPlatformLabel}`,
        `**状态**：${this.taskStatusLabel(task.status)}`,
        `**截止时间**：${this.formatDate(task.planned_end_at)}`,
        `**优先级**：${this.priorityLabel(task.priority)}`,
        `**任务执行人**：${assignee?.display_name ?? '-'}`,
        directoryUrl
          ? '请进入交付登记页上传图片资产，并补充合作链接。'
          : '请在任务详情中上传图片资产，并补充合作链接。',
      ].join('\n'),
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
      actionUrl: directoryUrl ?? this.buildTaskAssetSheetUrl(task),
      actionText: '登记交付资产',
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
      completed: '任务已验收',
      returned: '任务待修改',
      cancelled: '任务已取消',
    };
    const statusTitle =
      statusTitleMap[task.status] ?? `任务状态更新为 ${task.status}`;
    const statusLabel = taskStatusLabel(task.status);
    const assetCount =
      task.status === TaskStatus.Completed ||
      task.status === TaskStatus.PendingReview
        ? await this.taskResultFilesRepository.count({
            where: { task_id: task.id },
          })
        : null;
    const completedContent =
      task.status === TaskStatus.Completed
        ? [
            `任务名称：${task.task_name}`,
            '验收结果：已通过',
            `交付资产：${assetCount ?? 0} 项`,
            '交付内容已归档，可在需求面板查看统计与历史记录。',
          ]
        : null;

    return this.sendToUsers(recipients, {
      title:
        task.status === TaskStatus.Completed
          ? `验收通过：${task.task_name}`
          : `${statusTitle}：${task.task_name}`,
      content: (
        completedContent ?? [
          `任务编号：${task.task_no}`,
          `当前状态：${statusLabel}`,
          assetCount === null ? '' : `已登记资产：${assetCount} 项`,
          task.blocked_reason ? `补充说明：${task.blocked_reason}` : '',
        ]
      )
        .filter(Boolean)
        .join('\n'),
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
    });
  }

  async notifyTaskAssetsSubmittedForReview(
    task: TaskEntity,
    assetCount: number,
  ) {
    const reviewerUserId = await this.getTaskReviewerUserId(task);
    if (!reviewerUserId) {
      return null;
    }
    const [project, assignee] = await Promise.all([
      this.projectsRepository.findOne({ where: { id: task.project_id } }),
      task.assignee_user_id
        ? this.usersRepository.findOne({ where: { id: task.assignee_user_id } })
        : Promise.resolve(null),
    ]);
    const fundPlatformLabel = await this.taskFundPlatformLabel(task, project);
    const taskDetail = await this.taskDetailForNotification(task);

    return this.sendToUsers([reviewerUserId], {
      title: `任务待审核：${task.task_name}`,
      content: [
        `任务：${task.task_name}`,
        ...(taskDetail ? [`任务详情：${taskDetail}`] : []),
        `基金平台：${fundPlatformLabel}`,
        `执行人：${assignee?.display_name ?? '-'}`,
        `交付资产：${assetCount} 项`,
        `当前状态：${this.taskStatusLabel(task.status)}`,
        '请查看交付内容并完成当前审核。',
      ].join('\n'),
      objectType: 'task_asset_review',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
      actionUrl: this.buildTaskAssetReviewUrl(task, reviewerUserId),
      actionText: '查看交付资产',
    });
  }

  async notifyTaskAssetsSubmittedForProductReview(
    task: TaskEntity,
    assetCount: number,
    reviewerUserIds: string[],
  ) {
    const recipients = [...new Set(reviewerUserIds.filter(Boolean))];
    if (!recipients.length) {
      return null;
    }
    const [project, assignee] = await Promise.all([
      this.projectsRepository.findOne({ where: { id: task.project_id } }),
      task.assignee_user_id
        ? this.usersRepository.findOne({ where: { id: task.assignee_user_id } })
        : Promise.resolve(null),
    ]);
    const fundPlatformLabel = await this.taskFundPlatformLabel(task, project);
    const taskDetail = await this.taskDetailForNotification(task);
    return Promise.all(
      recipients.map((reviewerUserId) =>
        this.send({
          recipientUserId: reviewerUserId,
          title: `待一审：${task.task_name}`,
          content: [
            `任务：${task.task_name}`,
            ...(taskDetail ? [`任务详情：${taskDetail}`] : []),
            `基金平台：${fundPlatformLabel}`,
            `执行人：${assignee?.display_name ?? '-'}`,
            `交付资产：${assetCount} 项`,
            '请完成一审，确认交付物符合制作规范和交付标准。',
          ].join('\n'),
          objectType: 'task_asset_review',
          objectId: task.id,
          channels: ['in_app', 'feishu_app'],
          actionUrl: this.buildTaskAssetReviewUrl(task, reviewerUserId),
          actionText: '进入一审',
        }),
      ),
    );
  }

  async notifyTaskProductReviewApproved(
    task: TaskEntity,
    reviewerName: string,
    customerReviewerUserIds: string[],
  ) {
    const recipients = [...new Set(customerReviewerUserIds.filter(Boolean))];
    if (!recipients.length) {
      return null;
    }
    const project = await this.projectsRepository.findOne({
      where: { id: task.project_id },
    });
    const fundPlatformLabel = await this.taskFundPlatformLabel(task, project);
    return Promise.all(
      recipients.map((reviewerUserId) =>
        this.send({
          recipientUserId: reviewerUserId,
          title: `待二审：${task.task_name}`,
          content: [
            `任务：${task.task_name}`,
            `基金平台：${fundPlatformLabel}`,
            `一审结果：已由 ${reviewerName} 通过`,
            '请完成二审，确认交付物符合客户/基金公司的实际需求。',
          ].join('\n'),
          objectType: 'task_asset_review',
          objectId: task.id,
          channels: ['in_app', 'feishu_app'],
          actionUrl: this.buildTaskAssetReviewUrl(task, reviewerUserId),
          actionText: '进入二审',
        }),
      ),
    );
  }

  async notifyTaskCustomerReviewApproved(
    task: TaskEntity,
    assetCount: number,
    recipientUserIds: string[],
  ) {
    return this.sendToUsers(recipientUserIds, {
      title: `任务已验收：${task.task_name}`,
      content: [
        `任务名称：${task.task_name}`,
        '确认结果：已通过',
        `交付资产：${assetCount} 项`,
        '交付内容已归档，可在需求面板查看统计与历史记录。',
      ].join('\n'),
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
    });
  }

  async notifyTaskReviewReturned(
    task: TaskEntity,
    stageLabel: string,
    reviewerName: string,
    reason: string,
    recipientUserIds: string[],
  ) {
    return this.sendToUsers(recipientUserIds, {
      title: `任务退回修改：${task.task_name}`,
      content: [
        `任务名称：${task.task_name}`,
        `审核阶段：${stageLabel}`,
        `退回人：${reviewerName}`,
        `退回原因：${reason}`,
        '请修改后重新提交。',
      ].join('\n'),
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
      actionUrl: this.buildTaskAssetSheetUrl(task),
      actionText: '继续修改',
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
        '请更新交付资产，完成后重新提交。',
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
        content: [
          `任务编号：${task.task_no}`,
          `计划截止：${this.formatDate(task.planned_end_at)}`,
          `当前状态：${taskStatusLabel(task.status)}`,
          '请及时处理，避免影响交付验收。',
        ].join('\n'),
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
      reason:
        'Worklog reminders are not enabled for the current notification flow.',
      scannedTaskCount: 0,
      reminderCount: 0,
    };
  }

  async scanTaskProgressFeedback(dto: ScanTaskProgressFeedbackDto) {
    const daysAfterStart = Number(dto.daysAfterStart ?? 2);
    const repeatDays = Number(dto.repeatDays ?? 1);
    const startedBefore = new Date(
      Date.now() - daysAfterStart * 24 * 60 * 60 * 1000,
    );
    const duplicateSince = new Date(
      Date.now() - repeatDays * 24 * 60 * 60 * 1000,
    );
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.assignee_user_id IS NOT NULL')
      .andWhere('task.created_at <= :startedBefore', { startedBefore })
      .andWhere('task.status IN (:...statuses)', {
        statuses: [
          TaskStatus.Todo,
          TaskStatus.Pending,
          TaskStatus.Assigned,
          TaskStatus.InProgress,
          TaskStatus.Blocked,
          TaskStatus.Returned,
        ],
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
          created_at: MoreThanOrEqual(duplicateSince),
        },
      });
      if (existing > 0) {
        skippedDuplicateCount += 1;
        continue;
      }

      const messages = await this.sendToUsers([task.assignee_user_id!], {
        title: `请更新交付资产：${task.task_name}`,
        content: [
          `任务 ${task.task_no} 已开始超过 ${daysAfterStart} 天，请进入交付登记页更新进度或提交交付。`,
        ].join('\n'),
        objectType: 'task_progress_feedback',
        objectId: task.id,
        channels: ['in_app', 'feishu_app'],
        actionUrl: this.buildTaskAssetSheetUrl(task),
        actionText: '登记交付资产',
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
        title: `交付资产待登记：${task.task_name}`,
        content: [
          `任务编号：${task.task_no}`,
          `当前状态：${taskStatusLabel(task.status)}`,
          '系统尚未同步到交付资产，请进入在线资产表补充登记，便于验收和统计。',
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
    return taskStatusLabel(status);
  }

  private priorityLabel(priority: string | null) {
    const normalized = String(priority ?? '').toLowerCase();
    const legacy: Record<string, string> = {
      high: 'P0',
      medium: 'P1',
      low: 'P2',
    };
    if (legacy[normalized]) {
      return legacy[normalized];
    }
    const match = /^p(\d+)$/.exec(normalized);
    return match ? `P${Math.min(4, Number(match[1]))}` : '-';
  }

  private formatDate(value: Date | null) {
    if (!value) {
      return '-';
    }
    return `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, '0')}/${String(value.getDate()).padStart(2, '0')}`;
  }

  private async taskFundPlatformLabel(
    task: TaskEntity,
    project?: ProjectEntity | null,
  ) {
    const rows = await this.tasksRepository.manager.query(
      `
        SELECT
          COALESCE(requirement_customer.customer_name, project_customer.customer_name) AS customerName,
          requirement.business_platform AS businessPlatform
        FROM tasks task
        LEFT JOIN requirement_items item ON item.id = task.requirement_item_id
        LEFT JOIN requirements requirement ON requirement.id = item.requirement_id
        LEFT JOIN customers requirement_customer ON requirement_customer.customer_code = requirement.customer_code
        LEFT JOIN projects project ON project.id = task.project_id
        LEFT JOIN customers project_customer ON project_customer.customer_code = project.customer_code
        WHERE task.id = ?
        LIMIT 1
      `,
      [task.id],
    );
    const customerName =
      rows?.[0]?.customerName ?? project?.project_name ?? '未关联基金';
    const businessPlatform = rows?.[0]?.businessPlatform ?? '未关联平台';
    return `${customerName}-${businessPlatform}`;
  }

  private async taskDetailForNotification(task: TaskEntity) {
    const directDescription = this.compactNotificationText(task.description);
    if (directDescription) {
      return directDescription;
    }
    const rows = await this.tasksRepository.manager.query(
      `
        SELECT
          COALESCE(item.item_description, requirement.raw_content, requirement.summary) AS taskDetail
        FROM tasks task
        LEFT JOIN requirement_items item ON item.id = task.requirement_item_id
        LEFT JOIN requirements requirement ON requirement.id = item.requirement_id
        WHERE task.id = ?
        LIMIT 1
      `,
      [task.id],
    );
    return this.compactNotificationText(rows?.[0]?.taskDetail);
  }

  private compactNotificationText(value: unknown, maxLength = 260) {
    const text = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      return '';
    }
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  private buildTaskAssetSheetUrl(task: TaskEntity) {
    const token = this.taskAccessToken(task);
    return buildAppPublicUrl('/asset-sheet.html', {
      taskId: task.id,
      taskNo: task.task_no,
      token,
      start: 1,
    });
  }

  private withAssetSheetStart(url: string | null) {
    if (!url || !url.includes('/asset-sheet.html')) {
      return url;
    }
    const parsed = new URL(rebaseAppPublicUrl(url));
    parsed.searchParams.set('start', '1');
    return parsed.toString();
  }

  private buildTaskAssetReviewUrl(task: TaskEntity, reviewerUserId: string) {
    const token = this.taskReviewAccessToken(task, reviewerUserId);
    return buildAppPublicUrl('/asset-review.html', {
      taskId: task.id,
      token,
    });
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

  private taskReviewAccessToken(task: TaskEntity, reviewerUserId: string) {
    const secret =
      process.env.TASK_ACCESS_TOKEN_SECRET ??
      process.env.APP_SECRET ??
      process.env.DB_PASSWORD ??
      'xlyq-efficiency-engine-local-secret';
    return createHmac('sha256', secret)
      .update(`asset-review:${task.id}:${task.task_no}:${reviewerUserId}`)
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
    if (task.reporter_user_id) {
      recipients.push(task.reporter_user_id);
    } else {
      const ownerUserId = await this.getProjectOwnerUserId(task.project_id);
      if (ownerUserId) {
        recipients.push(ownerUserId);
      }
    }

    return [...new Set(recipients)];
  }

  private async getTaskReviewerUserId(task: TaskEntity) {
    if (task.reporter_user_id) {
      return task.reporter_user_id;
    }
    return this.getProjectOwnerUserId(task.project_id);
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
