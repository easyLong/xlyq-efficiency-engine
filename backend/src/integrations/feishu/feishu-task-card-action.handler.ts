import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { TaskEntity } from '../../tasks/entities/task.entity';
import {
  buildActiveProgressCard,
  buildCompletedProgressCard,
} from './feishu-card-templates';
import {
  asRecord,
  asString,
  getCardActionPayload,
} from './feishu-callback-parser';

@Injectable()
export class FeishuTaskCardActionHandler {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
  ) {}

  async handle(body: Record<string, unknown>) {
    const payload = getCardActionPayload(body);
    if (!payload) {
      return null;
    }

    const action = asRecord(payload.action);
    const value = asRecord(action?.value);
    const actionName = asString(value?.action);
    if (
      actionName !== 'task_progress_completed' &&
      actionName !== 'task_progress_reopen'
    ) {
      return {
        handled: false,
        action: actionName ?? 'unknown',
        taskId: asString(value?.taskId) ?? null,
        response: {
          toast: {
            type: 'warning',
            content: '暂不支持该操作。',
          },
        },
      };
    }

    const taskId = asString(value?.taskId);
    const taskNo = asString(value?.taskNo);
    const token = asString(value?.token);
    if (!taskId || !taskNo || !token) {
      return {
        handled: false,
        action: actionName,
        taskId: taskId ?? null,
        response: {
          toast: {
            type: 'error',
            content: '任务参数不完整，请联系管理员。',
          },
        },
      };
    }

    const task = await this.tasksRepository.findOne({
      where: { id: taskId, task_no: taskNo },
    });
    if (!task || !this.isValidTaskAccessToken(task, token)) {
      return {
        handled: false,
        action: actionName,
        taskId,
        response: {
          toast: {
            type: 'error',
            content: '任务校验失败，请联系管理员。',
          },
        },
      };
    }

    const cardBuilder =
      actionName === 'task_progress_completed'
        ? buildCompletedProgressCard
        : buildActiveProgressCard;
    return {
      handled: true,
      action: actionName,
      taskId: task.id,
      response: {
        toast: {
          type: 'warning',
          content: '请在项目资产页提交交付，审核通过后任务才会完成。',
        },
        card: cardBuilder({
          task,
          token: this.taskAccessToken(task),
          assetSheetUrl: this.buildTaskAssetSheetUrl(task),
        }),
      },
    };
  }

  private taskAccessToken(task: TaskEntity) {
    const secret =
      this.configService.get<string>('TASK_ACCESS_TOKEN_SECRET') ??
      this.configService.get<string>('APP_SECRET') ??
      this.configService.get<string>('DB_PASSWORD') ??
      'xlyq-efficiency-engine-local-secret';
    return createHmac('sha256', secret)
      .update(`${task.id}:${task.task_no}`)
      .digest('hex');
  }

  private isValidTaskAccessToken(task: TaskEntity, token: string) {
    const expected = this.taskAccessToken(task);
    return (
      token.length === expected.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    );
  }

  private buildTaskAssetSheetUrl(task: TaskEntity) {
    const baseUrl =
      this.configService.get<string>('APP_PUBLIC_BASE_URL') ??
      'http://localhost:3000';
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/asset-sheet.html`);
    url.searchParams.set('taskId', task.id);
    url.searchParams.set('taskNo', task.task_no);
    url.searchParams.set('token', this.taskAccessToken(task));
    url.searchParams.set('start', '1');
    return url.toString();
  }
}
