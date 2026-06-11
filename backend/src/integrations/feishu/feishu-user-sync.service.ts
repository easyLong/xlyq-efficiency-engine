import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { SyncFeishuUsersDto } from './dto/sync-feishu-users.dto';
import { FeishuSyncLogEntity } from './entities/feishu-sync-log.entity';
import { FeishuOpenApiClient } from './feishu-openapi.client';

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
export class FeishuUserSyncService {
  constructor(
    private readonly configService: ConfigService,
    private readonly openApiClient: FeishuOpenApiClient,
    @InjectRepository(FeishuSyncLogEntity)
    private readonly syncLogsRepository: Repository<FeishuSyncLogEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

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
      do {
        const body = await this.fetchUserPage({
          departmentId,
          pageSize,
          pageToken,
        });

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

  private async fetchUserPage(input: {
    departmentId: string;
    pageSize: number;
    pageToken: string;
  }) {
    const url = new URL('https://open.feishu.cn/open-apis/contact/v3/users');
    url.searchParams.set('department_id', input.departmentId);
    url.searchParams.set('department_id_type', 'open_department_id');
    url.searchParams.set('user_id_type', 'open_id');
    url.searchParams.set('page_size', String(input.pageSize));
    if (input.pageToken) {
      url.searchParams.set('page_token', input.pageToken);
    }

    const response = await this.openApiClient.request(url);
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

    return body;
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

  private async failLog(log: FeishuSyncLogEntity, error: unknown) {
    log.status = 'failed';
    log.error_message = error instanceof Error ? error.message : String(error);
    log.finished_at = new Date();
    await this.syncLogsRepository.save(log);
  }
}
