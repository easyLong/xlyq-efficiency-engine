import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SendBotMessageDto } from './dto/send-bot-message.dto';
import { FeishuSyncLogEntity } from './entities/feishu-sync-log.entity';

@Injectable()
export class FeishuService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(FeishuSyncLogEntity)
    private readonly syncLogsRepository: Repository<FeishuSyncLogEntity>,
  ) {}

  getConfigStatus() {
    return {
      appIdConfigured: Boolean(this.configService.get<string>('FEISHU_APP_ID')),
      appSecretConfigured: Boolean(
        this.configService.get<string>('FEISHU_APP_SECRET'),
      ),
      botWebhookConfigured: Boolean(
        this.configService.get<string>('FEISHU_BOT_WEBHOOK_URL'),
      ),
      eventVerificationTokenConfigured: Boolean(
        this.configService.get<string>('FEISHU_EVENT_VERIFICATION_TOKEN'),
      ),
      mvpMode: 'manual-requirements-and-mockable-feishu',
    };
  }

  async sendBotMessage(dto: SendBotMessageDto) {
    const payload = {
      msg_type: 'text',
      content: {
        text: dto.text,
      },
    };

    const log = this.syncLogsRepository.create({
      object_type: dto.objectType ?? 'system',
      object_id: dto.objectId ?? null,
      action_type: 'bot_message',
      feishu_object_type: dto.feishuObjectType ?? 'bot',
      feishu_object_id: dto.feishuObjectId ?? null,
      request_payload_json: payload,
      response_payload_json: null,
      status: 'pending',
      error_code: null,
      error_message: null,
      triggered_at: new Date(),
      finished_at: null,
    });
    await this.syncLogsRepository.save(log);

    const webhookUrl = this.configService.get<string>('FEISHU_BOT_WEBHOOK_URL');
    if (!webhookUrl) {
      log.status = 'mock_sent';
      log.response_payload_json = {
        mocked: true,
        reason: 'FEISHU_BOT_WEBHOOK_URL is not configured',
      };
      log.finished_at = new Date();
      return this.syncLogsRepository.save(log);
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      log.status = response.ok ? 'success' : 'failed';
      log.response_payload_json = {
        httpStatus: response.status,
        body: text,
      };
      log.error_message = response.ok ? null : text;
    } catch (error) {
      log.status = 'failed';
      log.error_message =
        error instanceof Error ? error.message : 'Unknown Feishu send error';
    }

    log.finished_at = new Date();
    return this.syncLogsRepository.save(log);
  }

  async handleWebhookEvent(body: Record<string, unknown>) {
    const challenge = typeof body.challenge === 'string' ? body.challenge : null;
    const event = (body.event ?? body) as Record<string, unknown>;

    const log = this.syncLogsRepository.create({
      object_type: 'feishu_event',
      object_id: null,
      action_type: 'webhook_event',
      feishu_object_type: String(body.type ?? event.type ?? 'event'),
      feishu_object_id: String(
        body.uuid ?? event.message_id ?? event.event_id ?? '',
      ),
      request_payload_json: body,
      response_payload_json: challenge ? { challenge } : { accepted: true },
      status: 'received',
      error_code: null,
      error_message: null,
      triggered_at: new Date(),
      finished_at: new Date(),
    });
    await this.syncLogsRepository.save(log);

    if (challenge) {
      return { challenge };
    }

    return {
      success: true,
      logId: log.id,
      nextAction: 'manual_requirement_review',
    };
  }

  listSyncLogs(objectType?: string, objectId?: string, status?: string) {
    return this.syncLogsRepository.find({
      where: {
        ...(objectType ? { object_type: objectType } : {}),
        ...(objectId ? { object_id: objectId } : {}),
        ...(status ? { status } : {}),
      },
      order: { triggered_at: 'DESC' },
      take: 100,
    });
  }
}
