import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isPublicHttpsAppBaseUrl } from '../../common/app-public-url';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createLarkChannel,
  LoggerLevel,
  type CardActionEvent,
  type LarkChannel,
} from '@larksuiteoapi/node-sdk';
import { Repository } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { SendAppMessageDto } from './dto/send-app-message.dto';
import { SendBotMessageDto } from './dto/send-bot-message.dto';
import { SyncFeishuUsersDto } from './dto/sync-feishu-users.dto';
import { FeishuSyncLogEntity } from './entities/feishu-sync-log.entity';
import { buildInteractiveCard } from './feishu-card-templates';
import { asRecord } from './feishu-callback-parser';
import { FeishuOpenApiClient } from './feishu-openapi.client';
import { ASSET_SHEET_HEADERS, FeishuSheetClient } from './feishu-sheet.client';
import { FeishuTaskCardActionHandler } from './feishu-task-card-action.handler';
import { FeishuUserSyncService } from './feishu-user-sync.service';

@Injectable()
export class FeishuService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(FeishuSyncLogEntity)
    private readonly syncLogsRepository: Repository<FeishuSyncLogEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly openApiClient: FeishuOpenApiClient,
    private readonly sheetClient: FeishuSheetClient,
    private readonly taskCardActionHandler: FeishuTaskCardActionHandler,
    private readonly userSyncService: FeishuUserSyncService,
  ) {}

  private larkChannel: LarkChannel | null = null;

  getConfigStatus() {
    const publicBaseUrl = String(
      this.configService.get<string>('APP_PUBLIC_BASE_URL') ?? '',
    ).trim();
    const localSheetPubliclyReachable = isPublicHttpsAppBaseUrl(publicBaseUrl);

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
      publicBaseUrl: publicBaseUrl || null,
      publicBaseUrlConfigured: Boolean(publicBaseUrl),
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
      integrationMode: 'feishu-contact-sync-and-notification-ready',
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
    const actions = dto.actions?.length
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
          buildInteractiveCard({
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
      const response = await this.openApiClient.postJson(
        `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${dto.receiveIdType}`,
        payload,
      );
      await this.finishLogFromResponse(log, response);
    } catch (error) {
      await this.failLog(log, error);
    }

    return this.syncLogsRepository.save(log);
  }

  async syncUsers(dto: SyncFeishuUsersDto) {
    return this.userSyncService.syncUsers(dto);
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

    const card = asRecord(result.response)?.card;
    const updateResults: Array<{
      delayMs: number;
      status: string;
      error?: string;
    }> = [];
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
      columns: ASSET_SHEET_HEADERS,
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
      const { spreadsheetToken, spreadsheetUrl, sheetId } =
        await this.sheetClient.createAssetSpreadsheet({
          title: input.title,
          folderToken: input.folderToken,
        });

      log.status = 'success';
      log.feishu_object_id = spreadsheetToken;
      log.response_payload_json = {
        spreadsheetToken,
        spreadsheetUrl,
        sheetId,
        template: {
          headers: ASSET_SHEET_HEADERS,
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
      const response = await this.sheetClient.grantSheetEditPermission({
        spreadsheetToken: input.spreadsheetToken,
        openId,
      });
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
        columns: ASSET_SHEET_HEADERS,
      },
    });

    try {
      const { range, assets } = await this.sheetClient.readAssetSheetRows(
        input.spreadsheetToken,
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

  private async handleCardAction(body: Record<string, unknown>) {
    return this.taskCardActionHandler.handle(body);
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
