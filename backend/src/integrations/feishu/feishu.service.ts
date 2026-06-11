import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createLarkChannel,
  LoggerLevel,
  type CardActionEvent,
  type LarkChannel,
} from '@larksuiteoapi/node-sdk';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { TaskEntity } from '../../tasks/entities/task.entity';
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
  nickname?: string;
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
export class FeishuService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(FeishuSyncLogEntity)
    private readonly syncLogsRepository: Repository<FeishuSyncLogEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
  ) {}

  private tenantAccessToken: string | null = null;
  private tenantAccessTokenExpiresAt = 0;
  private larkChannel: LarkChannel | null = null;

  getConfigStatus() {
    const publicBaseUrl =
      this.configService.get<string>('APP_PUBLIC_BASE_URL') ??
      'http://localhost:3000';
    const localSheetPubliclyReachable =
      /^https?:\/\/(?!localhost(?::|\/|$)|127\.0\.0\.1(?::|\/|$))/i.test(
        publicBaseUrl,
      );

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
      websocketCallbackEnabled: this.shouldEnableWebsocketCallbacks(),
      websocketCallbackConnected: Boolean(this.larkChannel),
      publicBaseUrl,
      localSheetPubliclyReachable,
      assetSheetMode: localSheetPubliclyReachable
        ? 'feishu_sheet_with_public_local_fallback'
        : 'feishu_sheet_required_for_external_users',
      recommendedScopes: [
        'contact:contact.base:readonly',
        'contact:department.organize:readonly',
        'contact:contact:readonly_as_app',
        'contact:user.employee_id:readonly',
        'contact:user.name:readonly',
        'drive:drive',
        'sheets:spreadsheet',
        'sheets:spreadsheet:create',
        'im:message',
      ],
      assetSheetPermissionHint:
        '若在线资产表创建失败，请在飞书开放平台为应用开通 drive:drive 或 sheets:spreadsheet/sheets:spreadsheet:create，并发布/启用权限变更。',
      mvpMode: 'feishu-contact-sync-and-notification-ready',
    };
  }

  async onModuleInit() {
    if (!this.shouldEnableWebsocketCallbacks()) {
      return;
    }

    const appId = this.configService.get<string>('FEISHU_APP_ID');
    const appSecret = this.configService.get<string>('FEISHU_APP_SECRET');
    if (!appId || !appSecret) {
      return;
    }

    const channel = createLarkChannel({
      appId,
      appSecret,
      loggerLevel: LoggerLevel.warn,
      includeRawEvent: true,
      source: 'xlyq-efficiency-engine',
    });
    channel.on('cardAction', (evt) => this.handleWebsocketCardAction(evt));
    channel.on('error', (error) => {
      console.error('[feishu websocket callback] error', error);
    });

    await channel.connect();
    this.larkChannel = channel;
    console.info('[feishu websocket callback] connected');
  }

  async onModuleDestroy() {
    if (!this.larkChannel) {
      return;
    }
    await this.larkChannel.disconnect();
    this.larkChannel = null;
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
    const actions =
      dto.actions?.length
        ? dto.actions
        : dto.actionUrl
          ? [
              {
                text: dto.actionText ?? '查看详情',
                url: dto.actionUrl,
                type: 'primary',
              },
            ]
          : [];
    const content = actions.length
      ? JSON.stringify(
          this.buildInteractiveCard({
            title: dto.title ?? '项目通知',
            text: dto.text,
            actions,
          }),
        )
      : JSON.stringify({ text: dto.text });
    const payload = {
      receive_id: dto.receiveId,
      msg_type: actions.length ? 'interactive' : 'text',
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
        const url = new URL(
          'https://open.feishu.cn/open-apis/contact/v3/users',
        );
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
      status: log.status,
      errorMessage: log.error_message,
      syncedCount: synced.length,
      users: synced,
    };
  }

  async handleWebhookEvent(body: Record<string, unknown>) {
    const challenge =
      typeof body.challenge === 'string' ? body.challenge : null;
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

    const cardActionResult = await this.handleCardAction(body);
    if (cardActionResult) {
      log.response_payload_json = {
        accepted: true,
        handled: cardActionResult.handled,
        action: cardActionResult.action,
        taskId: cardActionResult.taskId,
      };
      log.status = cardActionResult.handled ? 'success' : 'received';
      await this.syncLogsRepository.save(log);
      return cardActionResult.response;
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

  private async handleWebsocketCardAction(evt: CardActionEvent) {
    const result = await this.handleCardAction({
      header: {
        event_type: 'card.action.trigger',
      },
      event: {
        action: evt.action,
        message_id: evt.messageId,
        chat_id: evt.chatId,
        operator: evt.operator,
      },
    });
    if (!result?.handled) {
      return;
    }

    const card = this.asRecord(result.response)?.card;
    const updateResults: Array<{ delayMs: number; status: string; error?: string }> =
      [];
    if (card && this.larkChannel) {
      for (const delayMs of [800, 2000]) {
        await this.delay(delayMs);
        try {
          await this.larkChannel.updateCard(evt.messageId, card);
          updateResults.push({ delayMs, status: 'success' });
        } catch (error) {
          updateResults.push({
            delayMs,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    const log = this.syncLogsRepository.create({
      object_type: 'feishu_card_action',
      object_id: result.taskId,
      action_type: String(result.action),
      feishu_object_type: 'message_id',
      feishu_object_id: evt.messageId,
      request_payload_json: evt as unknown as Record<string, unknown>,
      response_payload_json: {
        ...(result.response as Record<string, unknown>),
        updateResults,
      },
      status: updateResults.some((item) => item.status === 'failed')
        ? 'partial_success'
        : 'success',
      error_code: null,
      error_message: null,
      triggered_at: new Date(),
      finished_at: new Date(),
    });
    await this.syncLogsRepository.save(log);
  }

  private shouldEnableWebsocketCallbacks() {
    return (
      this.configService.get<string>('FEISHU_ENABLE_WS_CALLBACKS') !== 'false'
    );
  }

  async createTaskAssetSpreadsheet(input: {
    title: string;
    objectId: string;
    folderToken?: string | null;
  }) {
    const requestPayload = {
      title: input.title,
      folderToken: input.folderToken ?? null,
      columns: ['编号', '资产地址', '图片地址（可多张）', '交付链接'],
    };
    const log = await this.createSyncLog({
      objectType: 'task',
      objectId: input.objectId,
      actionType: 'create_asset_spreadsheet',
      feishuObjectType: 'sheet',
      feishuObjectId: null,
      requestPayload,
    });

    try {
      const tenantAccessToken = await this.getTenantAccessToken();
      const createPayload: Record<string, unknown> = { title: input.title };
      if (input.folderToken) {
        createPayload.folder_token = input.folderToken;
      }

      const createResponse = await fetch(
        'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tenantAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(createPayload),
        },
      );
      const createBody = (await createResponse.json()) as {
        code?: number;
        msg?: string;
        data?: {
          spreadsheet?: {
            spreadsheet_token?: string;
            url?: string;
          };
          spreadsheet_token?: string;
          url?: string;
        };
      };

      if (!createResponse.ok || createBody.code !== 0) {
        throw new Error(
          `Feishu spreadsheet create failed: ${createResponse.status} ${createBody.msg ?? ''}`,
        );
      }

      const spreadsheetToken =
        createBody.data?.spreadsheet?.spreadsheet_token ??
        createBody.data?.spreadsheet_token;
      const spreadsheetUrl =
        createBody.data?.spreadsheet?.url ??
        createBody.data?.url ??
        (spreadsheetToken
          ? `https://www.feishu.cn/sheets/${spreadsheetToken}`
          : null);
      if (!spreadsheetToken || !spreadsheetUrl) {
        throw new Error('Feishu spreadsheet create response missing token/url');
      }

      const sheetId = await this.getFirstSheetId(
        tenantAccessToken,
        spreadsheetToken,
      );
      if (sheetId) {
        await this.writeAssetSheetTemplate(
          tenantAccessToken,
          spreadsheetToken,
          sheetId,
        );
      }

      log.status = 'success';
      log.feishu_object_id = spreadsheetToken;
      log.response_payload_json = {
        spreadsheetToken,
        spreadsheetUrl,
        sheetId,
        template: {
          headers: ['编号', '资产地址', '图片地址（可多张）', '交付链接'],
          autoNumberFormula: '=ROW()-1',
          preparedRows: 500,
        },
      };
      log.finished_at = new Date();
      await this.syncLogsRepository.save(log);

      return {
        spreadsheetToken,
        spreadsheetUrl,
        sheetId,
        log,
      };
    } catch (error) {
      await this.failLog(log, error);
      throw error;
    }
  }

  async grantSpreadsheetEditPermission(input: {
    spreadsheetToken: string;
    userId: string;
    objectId: string;
  }) {
    const user = await this.usersRepository.findOne({
      where: { id: input.userId },
    });
    const openId = user?.feishu_open_id;
    if (!openId) {
      throw new Error('Assignee has no feishu_open_id for sheet permission');
    }

    const payload = {
      member_type: 'openid',
      member_id: openId,
      perm: 'edit',
    };
    const log = await this.createSyncLog({
      objectType: 'task',
      objectId: input.objectId,
      actionType: 'grant_asset_sheet_permission',
      feishuObjectType: 'sheet',
      feishuObjectId: input.spreadsheetToken,
      requestPayload: payload,
    });

    try {
      const tenantAccessToken = await this.getTenantAccessToken();
      const response = await fetch(
        `https://open.feishu.cn/open-apis/drive/v1/permissions/${input.spreadsheetToken}/members?type=sheet`,
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
      await this.syncLogsRepository.save(log);
      if (log.status !== 'success') {
        throw new Error(log.error_message ?? 'Grant sheet permission failed');
      }
      return log;
    } catch (error) {
      await this.failLog(log, error);
      throw error;
    }
  }

  async readAssetSheetRows(input: {
    spreadsheetToken: string;
    objectId: string;
  }) {
    const log = await this.createSyncLog({
      objectType: 'task',
      objectId: input.objectId,
      actionType: 'sync_asset_sheet_rows',
      feishuObjectType: 'sheet',
      feishuObjectId: input.spreadsheetToken,
      requestPayload: {
        columns: ['编号', '资产地址', '图片地址（可多张）', '交付链接'],
      },
    });

    try {
      const tenantAccessToken = await this.getTenantAccessToken();
      const sheetId = await this.getFirstSheetId(
        tenantAccessToken,
        input.spreadsheetToken,
      );
      if (!sheetId) {
        throw new Error('Asset sheet has no sheetId');
      }

      const range = `${sheetId}!A2:D501`;
      const url = new URL(
        `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${input.spreadsheetToken}/values_batch_get`,
      );
      url.searchParams.append('ranges', range);
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
        },
      });
      const body = (await response.json()) as {
        code?: number;
        msg?: string;
        data?: {
          valueRanges?: Array<{
            values?: unknown[][];
          }>;
        };
      };
      if (!response.ok || body.code !== 0) {
        throw new Error(
          `Feishu asset sheet read failed: ${response.status} ${body.msg ?? ''}`,
        );
      }

      const rows = body.data?.valueRanges?.[0]?.values ?? [];
      const assets = rows
        .map((row, index) => ({
          sequence: index + 1,
          assetUrl: String(row[1] ?? '').trim(),
          imageUrls: String(row[2] ?? '')
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean),
          linkUrl: String(row[3] ?? '').trim(),
        }))
        .filter(
          (row) =>
            row.assetUrl.length > 0 ||
            row.imageUrls.length > 0 ||
            row.linkUrl.length > 0,
        );

      log.status = 'success';
      log.response_payload_json = {
        range,
        count: assets.length,
        assets,
      };
      log.finished_at = new Date();
      await this.syncLogsRepository.save(log);

      return assets;
    } catch (error) {
      await this.failLog(log, error);
      throw error;
    }
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
        display_name: this.getFeishuDisplayName(item) ?? username,
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
      display_name: this.getFeishuDisplayName(item) ?? user.display_name,
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

  private getFeishuDisplayName(item: FeishuUserItem) {
    return item.name ?? item.nickname ?? item.en_name ?? null;
  }

  private async getFirstSheetId(
    tenantAccessToken: string,
    spreadsheetToken: string,
  ) {
    const response = await fetch(
      `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`,
      {
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
        },
      },
    );
    const body = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: {
        sheets?: Array<{
          sheet_id?: string;
          sheetId?: string;
        }>;
      };
    };
    if (!response.ok || body.code !== 0) {
      throw new Error(
        `Feishu sheet query failed: ${response.status} ${body.msg ?? ''}`,
      );
    }
    const firstSheet = body.data?.sheets?.[0];
    return firstSheet?.sheet_id ?? firstSheet?.sheetId ?? null;
  }

  private async writeAssetSheetTemplate(
    tenantAccessToken: string,
    spreadsheetToken: string,
    sheetId: string,
  ) {
    const rows = [
      ['编号', '资产地址', '图片地址（可多张）', '交付链接'],
      ...Array.from({ length: 500 }, () => ['=ROW()-1', '', '', '']),
    ];
    const response = await fetch(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueRange: {
            range: `${sheetId}!A1:D501`,
            values: rows,
          },
        }),
      },
    );
    const body = (await response.json()) as {
      code?: number;
      msg?: string;
    };
    if (!response.ok || body.code !== 0) {
      throw new Error(
        `Feishu sheet template write failed: ${response.status} ${body.msg ?? ''}`,
      );
    }
  }

  private buildInteractiveCard(input: {
    title: string;
    text: string;
    actions: Array<{
      text: string;
      url?: string;
      type?: string;
      value?: Record<string, unknown>;
    }>;
  }) {
    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: 'green',
        title: {
          tag: 'plain_text',
          content: input.title,
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: input.text,
          },
        },
        {
          tag: 'action',
          actions: input.actions.map((action) => ({
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: action.text,
            },
            type: action.type ?? 'primary',
            ...(action.url ? { url: action.url } : {}),
            ...(action.value ? { value: action.value } : {}),
          })),
        },
      ],
    };
  }

  private async handleCardAction(body: Record<string, unknown>) {
    const payload = this.getCardActionPayload(body);
    if (!payload) {
      return null;
    }

    const action = this.asRecord(payload.action);
    const value = this.asRecord(action?.value);
    const actionName = this.asString(value?.action);
    if (
      actionName !== 'task_progress_completed' &&
      actionName !== 'task_progress_reopen'
    ) {
      return {
        handled: false,
        action: actionName ?? 'unknown',
        taskId: this.asString(value?.taskId) ?? null,
        response: {
          toast: {
            type: 'warning',
            content: '暂不支持该操作。',
          },
        },
      };
    }

    const taskId = this.asString(value?.taskId);
    const taskNo = this.asString(value?.taskNo);
    const token = this.asString(value?.token);
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

    if (actionName === 'task_progress_reopen') {
      task.status = 'in_progress';
      task.progress_percent = Math.max(Number(task.progress_percent ?? 0), 30);
      task.actual_end_at = null;
      await this.tasksRepository.save(task);

      return {
        handled: true,
        action: actionName,
        taskId,
        response: {
          toast: {
            type: 'success',
            content: `已重新打开 ${task.task_no} 任务。`,
          },
          card: this.buildActiveProgressCard(task),
        },
      };
    }

    task.status = 'completed';
    task.progress_percent = 100;
    task.actual_end_at = task.actual_end_at ?? new Date();
    await this.tasksRepository.save(task);

    return {
      handled: true,
      action: actionName,
      taskId,
      response: {
        toast: {
          type: 'success',
          content: `已完成 ${task.task_no} 任务。`,
        },
        card: this.buildCompletedProgressCard(task),
      },
    };
  }

  private getCardActionPayload(body: Record<string, unknown>) {
    const event = this.asRecord(body.event);
    const header = this.asRecord(body.header);
    const eventType =
      this.asString(header?.event_type) ??
      this.asString(body.type) ??
      this.asString(event?.type);
    const hasAction = Boolean(
      this.asRecord(event?.action) ?? this.asRecord(body.action),
    );
    if (
      eventType !== 'card.action.trigger' &&
      eventType !== 'card_action' &&
      !hasAction
    ) {
      return null;
    }
    return event ?? body;
  }

  private buildCompletedProgressCard(task: TaskEntity) {
    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: 'green',
        title: {
          tag: 'plain_text',
          content: '任务进度反馈',
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `任务 ${task.task_no}「${task.task_name}」已标记为已完成。`,
          },
        },
        {
          tag: 'action',
          actions: [
            this.buildCallbackButton('再次打开', {
              action: 'task_progress_reopen',
              taskId: task.id,
              taskNo: task.task_no,
              token: this.taskAccessToken(task),
            }),
            this.buildDisabledButton('已完成'),
          ],
        },
      ],
    };
  }

  private buildActiveProgressCard(task: TaskEntity) {
    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: 'green',
        title: {
          tag: 'plain_text',
          content: '任务进度反馈',
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `任务 ${task.task_no}「${task.task_name}」已重新打开，请继续反馈当前进度。`,
          },
        },
        {
          tag: 'action',
          actions: [
            this.buildUrlButton('进行中', this.buildTaskAssetSheetUrl(task)),
            this.buildCallbackButton('已完成', {
              action: 'task_progress_completed',
              taskId: task.id,
              taskNo: task.task_no,
              token: this.taskAccessToken(task),
            }),
          ],
        },
      ],
    };
  }

  private buildDisabledButton(text: string) {
    return {
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: text,
      },
      type: 'default',
      disabled: true,
    };
  }

  private buildUrlButton(text: string, url: string) {
    return {
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: text,
      },
      type: 'primary',
      url,
    };
  }

  private buildCallbackButton(text: string, value: Record<string, unknown>) {
    return {
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: text,
      },
      type: 'primary',
      value,
    };
  }

  private isValidTaskAccessToken(task: TaskEntity, token: string) {
    const expected = this.taskAccessToken(task);
    if (token.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
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

  private buildTaskAssetSheetUrl(
    task: TaskEntity,
    options?: { reopen?: boolean },
  ) {
    const baseUrl =
      this.configService.get<string>('APP_PUBLIC_BASE_URL') ??
      'http://localhost:3000';
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/asset-sheet.html`);
    url.searchParams.set('taskId', task.id);
    url.searchParams.set('taskNo', task.task_no);
    url.searchParams.set('token', this.taskAccessToken(task));
    if (options?.reopen) {
      url.searchParams.set('reopen', '1');
    }
    return url.toString();
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  }

  private asString(value: unknown) {
    return typeof value === 'string' ? value : null;
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

    log.response_payload_json = {
      httpStatus: response.status,
      body: parsed,
    };
    const feishuCode =
      typeof parsed === 'object' &&
      parsed !== null &&
      'code' in parsed &&
      typeof parsed.code === 'number'
        ? parsed.code
        : 0;
    const success = response.ok && feishuCode === 0;
    log.status = success ? 'success' : 'failed';
    log.error_message = success ? null : text;
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
