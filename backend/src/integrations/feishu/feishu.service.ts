import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { SendAppMessageDto } from './dto/send-app-message.dto';
import { SendBotMessageDto } from './dto/send-bot-message.dto';
import { SyncFeishuUsersDto } from './dto/sync-feishu-users.dto';
import { FeishuSyncLogEntity } from './entities/feishu-sync-log.entity';

type FeishuTokenResponse = {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
};

type FeishuUserItem = {
  open_id?: string;
  user_id?: string;
  union_id?: string;
  name?: string;
  en_name?: string;
  email?: string;
  mobile?: string;
  avatar?: {
    avatar_72?: string;
    avatar_240?: string;
    avatar_640?: string;
    avatar_origin?: string;
  };
  status?: {
    is_frozen?: boolean;
    is_resigned?: boolean;
    is_activated?: boolean;
  };
};

@Injectable()
export class FeishuService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(FeishuSyncLogEntity)
    private readonly syncLogsRepository: Repository<FeishuSyncLogEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  private tenantAccessToken: string | null = null;
  private tenantAccessTokenExpiresAt = 0;

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
      defaultDepartmentId:
        this.configService.get<string>('FEISHU_DEFAULT_DEPARTMENT_ID') ?? '0',
      appMessageAvailable: Boolean(
        this.configService.get<string>('FEISHU_APP_ID') &&
          this.configService.get<string>('FEISHU_APP_SECRET'),
      ),
      botWebhookAvailable: Boolean(
        this.configService.get<string>('FEISHU_BOT_WEBHOOK_URL'),
      ),
      recommendedScopes: [
        'contact:user.base:readonly',
        'contact:user.email:readonly',
        'im:message',
      ],
      mvpMode: 'feishu-contact-sync-and-notification-ready',
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

  async sendAppMessage(dto: SendAppMessageDto) {
    const content = JSON.stringify({ text: dto.text });
    const payload = {
      receive_id: dto.receiveId,
      msg_type: 'text',
      content,
    };

    const log = await this.createSyncLog({
      objectType: dto.objectType ?? 'system',
      objectId: dto.objectId ?? null,
      actionType: 'app_message',
      feishuObjectType: dto.receiveIdType,
      feishuObjectId: dto.receiveId,
      requestPayload: payload,
    });

    try {
      const tenantAccessToken = await this.getTenantAccessToken();
      const response = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${dto.receiveIdType}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tenantAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      await this.finishLogFromResponse(log, response);
    } catch (error) {
      await this.failLog(log, error);
    }

    return this.syncLogsRepository.save(log);
  }

  async syncUsers(dto: SyncFeishuUsersDto) {
    const departmentId =
      dto.departmentId ??
      this.configService.get<string>('FEISHU_DEFAULT_DEPARTMENT_ID') ??
      '0';
    const pageSize = Number(dto.pageSize ?? 50);
    const synced: UserEntity[] = [];
    let pageToken = '';

    const log = await this.createSyncLog({
      objectType: 'user',
      objectId: null,
      actionType: 'sync_contacts',
      feishuObjectType: 'department',
      feishuObjectId: departmentId,
      requestPayload: { departmentId, pageSize },
    });

    try {
      const tenantAccessToken = await this.getTenantAccessToken();
      do {
        const url = new URL('https://open.feishu.cn/open-apis/contact/v3/users');
        url.searchParams.set('department_id', departmentId);
        url.searchParams.set('department_id_type', 'open_department_id');
        url.searchParams.set('user_id_type', 'open_id');
        url.searchParams.set('page_size', String(pageSize));
        if (pageToken) {
          url.searchParams.set('page_token', pageToken);
        }

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${tenantAccessToken}`,
          },
        });
        const body = (await response.json()) as {
          code?: number;
          msg?: string;
          data?: {
            items?: FeishuUserItem[];
            has_more?: boolean;
            page_token?: string;
          };
        };

        if (!response.ok || body.code !== 0) {
          throw new Error(
            `Feishu contact sync failed: ${response.status} ${body.msg ?? ''}`,
          );
        }

        for (const item of body.data?.items ?? []) {
          const user = await this.upsertFeishuUser(item);
          if (user) {
            synced.push(user);
          }
        }
        pageToken = body.data?.has_more ? (body.data.page_token ?? '') : '';
      } while (pageToken);

      log.status = 'success';
      log.response_payload_json = {
        syncedCount: synced.length,
        departmentId,
      };
    } catch (error) {
      await this.failLog(log, error);
    }

    log.finished_at = new Date();
    await this.syncLogsRepository.save(log);

    return {
      logId: log.id,
      syncedCount: synced.length,
      users: synced,
    };
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

  private async getTenantAccessToken() {
    const now = Date.now();
    if (
      this.tenantAccessToken &&
      this.tenantAccessTokenExpiresAt - 60_000 > now
    ) {
      return this.tenantAccessToken;
    }

    const appId = this.configService.get<string>('FEISHU_APP_ID');
    const appSecret = this.configService.get<string>('FEISHU_APP_SECRET');
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException(
        'FEISHU_APP_ID and FEISHU_APP_SECRET are required for Feishu app APIs',
      );
    }

    const response = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret,
        }),
      },
    );
    const body = (await response.json()) as FeishuTokenResponse;
    if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
      throw new Error(
        `Failed to get Feishu tenant_access_token: ${response.status} ${body.msg ?? ''}`,
      );
    }

    this.tenantAccessToken = body.tenant_access_token;
    this.tenantAccessTokenExpiresAt = now + (body.expire ?? 7200) * 1000;
    return this.tenantAccessToken;
  }

  private async upsertFeishuUser(item: FeishuUserItem) {
    const openId = item.open_id;
    if (!openId) {
      return null;
    }

    const existing =
      (await this.usersRepository.findOne({
        where: { feishu_open_id: openId },
      })) ??
      (item.email
        ? await this.usersRepository.findOne({ where: { email: item.email } })
        : null);

    const status =
      item.status?.is_resigned || item.status?.is_frozen
        ? 'inactive'
        : 'active';
    const username = this.buildUsername(item);

    const user =
      existing ??
      this.usersRepository.create({
        id: randomUUID(),
        username,
        display_name: item.name ?? username,
        email: item.email ?? null,
        mobile: item.mobile ?? null,
        avatar_url:
          item.avatar?.avatar_240 ??
          item.avatar?.avatar_72 ??
          item.avatar?.avatar_origin ??
          null,
        status,
        source: 'feishu',
        feishu_open_id: openId,
      });

    Object.assign(user, {
      display_name: item.name ?? user.display_name,
      email: item.email ?? user.email,
      mobile: item.mobile ?? user.mobile,
      avatar_url:
        item.avatar?.avatar_240 ??
        item.avatar?.avatar_72 ??
        item.avatar?.avatar_origin ??
        user.avatar_url,
      status,
      source: 'feishu',
      feishu_open_id: openId,
    });

    return this.usersRepository.save(user);
  }

  private buildUsername(item: FeishuUserItem) {
    return (
      item.email?.split('@')[0] ??
      item.mobile ??
      item.user_id ??
      item.open_id ??
      `feishu_${randomUUID().slice(0, 8)}`
    ).slice(0, 64);
  }

  private async createSyncLog(input: {
    objectType: string;
    objectId: string | null;
    actionType: string;
    feishuObjectType: string;
    feishuObjectId: string | null;
    requestPayload: Record<string, unknown>;
  }) {
    return this.syncLogsRepository.save(
      this.syncLogsRepository.create({
        object_type: input.objectType,
        object_id: input.objectId,
        action_type: input.actionType,
        feishu_object_type: input.feishuObjectType,
        feishu_object_id: input.feishuObjectId,
        request_payload_json: input.requestPayload,
        response_payload_json: null,
        status: 'pending',
        error_code: null,
        error_message: null,
        triggered_at: new Date(),
        finished_at: null,
      }),
    );
  }

  private async finishLogFromResponse(
    log: FeishuSyncLogEntity,
    response: Response,
  ) {
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    log.status = response.ok ? 'success' : 'failed';
    log.response_payload_json = {
      httpStatus: response.status,
      body: parsed,
    };
    log.error_message = response.ok ? null : text;
    log.finished_at = new Date();
  }

  private async failLog(log: FeishuSyncLogEntity, error: unknown) {
    log.status = 'failed';
    log.error_message =
      error instanceof Error ? error.message : 'Unknown Feishu API error';
    log.finished_at = new Date();
    await this.syncLogsRepository.save(log);
  }
}
