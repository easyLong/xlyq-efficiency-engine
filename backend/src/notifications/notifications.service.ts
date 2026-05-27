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
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskResultFileEntity } from '../tasks/entities/task-result-file.entity';
import { UserEntity } from '../users/entities/user.entity';
import { ScanFeishuSyncFailuresDto } from './dto/scan-feishu-sync-failures.dto';
import { ScanTaskDeadlinesDto } from './dto/scan-task-deadlines.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SendWorklogRemindersDto } from './dto/send-worklog-reminders.dto';
import { NotificationMessageEntity } from './entities/notification-message.entity';

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
        result.feishu_app = await this.sendFeishuAppMessage(message);
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
        `你收到一个新任务 ${task.task_no}，请查看任务详情并及时更新进度。`,
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
    });
  }

  async notifyTaskStatusChanged(task: TaskEntity) {
    const recipients = await this.getTaskStakeholders(task);
    if (!recipients.length) {
      return null;
    }

    const statusTitleMap: Record<string, string> = {
      blocked: '任务阻塞',
      pending_review: '任务待验收',
      completed: '任务已完成',
    };

    return this.sendToUsers(recipients, {
      title: `${statusTitleMap[task.status] ?? '任务状态更新'}：${task.task_name}`,
      content: `任务 ${task.task_no} 当前状态为 ${task.status}，进度 ${task.progress_percent}%。${task.blocked_reason ? `阻塞原因：${task.blocked_reason}` : ''}`,
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
    });
  }

  async notifyTaskResultFileSubmitted(
    task: TaskEntity,
    file: TaskResultFileEntity,
  ) {
    const recipients = await this.getTaskStakeholders(task);
    return this.sendToUsers(recipients, {
      title: `成果文件已提交：${task.task_name}`,
      content: `任务 ${task.task_no} 新增成果文件「${file.file_name}」，请及时查看和验收。`,
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
    const dueBefore = new Date(
      now.getTime() + daysAhead * 24 * 60 * 60 * 1000,
    );

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
    const workDate = dto.workDate ?? new Date().toISOString().slice(0, 10);
    const tasksQb = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.status IN (:...statuses)', {
        statuses: ['todo', 'in_progress', 'blocked', 'pending_review'],
      })
      .andWhere('task.assignee_user_id IS NOT NULL');

    if (dto.projectId) {
      tasksQb.andWhere('task.project_id = :projectId', {
        projectId: dto.projectId,
      });
    }

    const tasks = await tasksQb.getMany();
    let reminderCount = 0;

    for (const task of tasks) {
      const count = await this.worklogsRepository.count({
        where: {
          task_id: task.id,
          user_id: task.assignee_user_id!,
          work_date: workDate,
        },
      });
      if (count > 0) {
        continue;
      }

      const messages = await this.sendToUsers([task.assignee_user_id!], {
        title: `工时待提交：${task.task_name}`,
        content: `你今天还没有为任务 ${task.task_no} 填写工时，请及时补充。`,
        objectType: 'task',
        objectId: task.id,
        channels: ['in_app', 'feishu_app'],
      });
      reminderCount += messages.length;
    }

    return {
      workDate,
      scannedTaskCount: tasks.length,
      reminderCount,
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

  private async sendFeishuAppMessage(message: NotificationMessageEntity) {
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
      text: `${message.title}\n${message.content}`,
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
