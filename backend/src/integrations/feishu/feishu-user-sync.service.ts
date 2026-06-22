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

type FeishuDepartmentItem = {
  department_id?: string;
  open_department_id?: string;
  name?: string;
  status?: {
    is_deleted?: boolean;
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
    const includeSubDepartments = dto.includeSubDepartments !== false;
    const synced: UserEntity[] = [];
    const syncedOpenIds = new Set<string>();

    const log = await this.createSyncLog({
      objectType: 'user',
      objectId: null,
      actionType: 'sync_contacts',
      feishuObjectType: 'department',
      feishuObjectId: departmentId,
      requestPayload: { departmentId, pageSize, includeSubDepartments },
    });

    try {
      const departments = await this.resolveDepartmentsToSync({
        departmentId,
        pageSize,
        includeSubDepartments,
      });

      for (const department of departments) {
        let pageToken = '';
        do {
          const body = await this.fetchUserPage({
            departmentId: department.id,
            pageSize,
            pageToken,
          });

          for (const item of body.data?.items ?? []) {
            if (!item.open_id || syncedOpenIds.has(item.open_id)) {
              continue;
            }
            syncedOpenIds.add(item.open_id);
            const user = await this.upsertFeishuUser(item);
            if (user) {
              synced.push(user);
            }
          }
          pageToken = body.data?.has_more ? (body.data.page_token ?? '') : '';
        } while (pageToken);
      }

      log.status = 'success';
      log.response_payload_json = {
        syncedCount: synced.length,
        departmentId,
        departmentCount: departments.length,
        departments,
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

  private async resolveDepartmentsToSync(input: {
    departmentId: string;
    pageSize: number;
    includeSubDepartments: boolean;
  }) {
    const departments = new Map<string, { id: string; name: string | null }>();
    departments.set(input.departmentId, {
      id: input.departmentId,
      name: input.departmentId === '0' ? 'root' : null,
    });

    if (!input.includeSubDepartments) {
      return Array.from(departments.values());
    }

    let pageToken = '';
    do {
      const body = await this.fetchDepartmentChildrenPage({
        departmentId: input.departmentId,
        pageSize: input.pageSize,
        pageToken,
      });

      for (const item of body.data?.items ?? []) {
        if (item.status?.is_deleted) {
          continue;
        }
        const id = item.open_department_id ?? item.department_id;
        if (id) {
          departments.set(id, { id, name: item.name ?? null });
        }
      }
      pageToken = body.data?.has_more ? (body.data.page_token ?? '') : '';
    } while (pageToken);

    return Array.from(departments.values());
  }

  private async fetchDepartmentChildrenPage(input: {
    departmentId: string;
    pageSize: number;
    pageToken: string;
  }) {
    const url = new URL(
      `https://open.feishu.cn/open-apis/contact/v3/departments/${encodeURIComponent(input.departmentId)}/children`,
    );
    url.searchParams.set('department_id_type', 'open_department_id');
    url.searchParams.set('user_id_type', 'open_id');
    url.searchParams.set('fetch_child', 'true');
    url.searchParams.set('page_size', String(input.pageSize));
    if (input.pageToken) {
      url.searchParams.set('page_token', input.pageToken);
    }

    const response = await this.openApiClient.request(url);
    const body = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: {
        items?: FeishuDepartmentItem[];
        has_more?: boolean;
        page_token?: string;
      };
    };

    if (!response.ok || body.code !== 0) {
      throw new Error(
        `Feishu department sync failed: ${response.status} ${body.msg ?? ''}`,
      );
    }

    return body;
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
    const feishuDisplayName = this.getFeishuDisplayName(item);
    const displayName = this.buildDisplayName(item, username);

    const user =
      existing ??
      this.usersRepository.create({
        id: randomUUID(),
        username,
        display_name: displayName,
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
      display_name: this.resolveDisplayName(
        user.display_name,
        displayName,
        Boolean(feishuDisplayName),
      ),
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

  private buildDisplayName(item: FeishuUserItem, username: string) {
    return (
      this.getFeishuDisplayName(item) ??
      item.email?.split('@')[0] ??
      item.mobile ??
      (this.isTechnicalFeishuId(username) ? '未同步昵称' : username)
    ).slice(0, 64);
  }

  private getFeishuDisplayName(item: FeishuUserItem) {
    return item.name ?? item.nickname ?? item.en_name ?? null;
  }

  private shouldUpdateDisplayName(current: string | null | undefined) {
    return (
      !current || current === '未同步昵称' || this.isTechnicalFeishuId(current)
    );
  }

  private resolveDisplayName(
    current: string | null | undefined,
    candidate: string,
    fromFeishuNameField: boolean,
  ) {
    if (
      !fromFeishuNameField &&
      current &&
      !this.shouldUpdateDisplayName(current)
    ) {
      return current;
    }
    if (!this.isPlaceholderDisplayName(candidate)) {
      return candidate;
    }
    return this.shouldUpdateDisplayName(current) ? candidate : current;
  }

  private isPlaceholderDisplayName(value: string | null | undefined) {
    return !value || value === '未同步昵称' || this.isTechnicalFeishuId(value);
  }

  private isTechnicalFeishuId(value: string | null | undefined) {
    return /^ou_[a-z0-9]+$/i.test(value ?? '');
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
