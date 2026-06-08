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
    const content = dto.actionUrl
      ? JSON.stringify(
          this.buildInteractiveCard({
            title: dto.title ?? '项目通知',
            text: dto.text,
            actionUrl: dto.actionUrl,
            actionText: dto.actionText ?? '查看详情',
          }),
        )
      : JSON.stringify({ text: dto.text });
    const payload = {
      receive_id: dto.receiveId,
      msg_type: dto.actionUrl ? 'interactive' : 'text',
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
    actionUrl: string;
    actionText: string;
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
          actions: [
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: input.actionText,
              },
              type: 'primary',
              url: input.actionUrl,
            },
          ],
        },
      ],
    };
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
