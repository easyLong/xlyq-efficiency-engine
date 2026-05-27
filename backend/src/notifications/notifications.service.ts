import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { FeishuService } from '../integrations/feishu/feishu.service';
import { TaskEntity } from '../tasks/entities/task.entity';
import { UserEntity } from '../users/entities/user.entity';
import { SendNotificationDto } from './dto/send-notification.dto';
import { NotificationMessageEntity } from './entities/notification-message.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationMessageEntity)
    private readonly notificationsRepository: Repository<NotificationMessageEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
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

    return this.send({
      recipientUserId: task.assignee_user_id,
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
    if (!task.assignee_user_id) {
      return null;
    }

    return this.send({
      recipientUserId: task.assignee_user_id,
      title: `任务状态更新：${task.task_name}`,
      content: `任务 ${task.task_no} 当前状态为 ${task.status}，进度 ${task.progress_percent}%。`,
      objectType: 'task',
      objectId: task.id,
      channels: ['in_app', 'feishu_app'],
    });
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
}
