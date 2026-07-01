import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { ensureIndex } from '../common/schema-maintenance';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { CreateContactContextConfigDto } from './dto/create-contact-context-config.dto';
import { CreateSourceContactContextDto } from './dto/create-source-contact-context.dto';
import { CreateWechatGroupConfigDto } from './dto/create-wechat-group-config.dto';
import { UpdateContactContextConfigDto } from './dto/update-contact-context-config.dto';
import { UpdateSourceContactContextDto } from './dto/update-source-contact-context.dto';
import { UpdateWechatGroupConfigDto } from './dto/update-wechat-group-config.dto';

@Injectable()
export class ContactContextsService implements OnModuleInit {
  constructor(
    @InjectRepository(CustomerEntity)
    private readonly customersRepository: Repository<CustomerEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureGroupContactMappingsSchema();
    await this.migrateLegacyContactContextsToGroupMappings();
    await this.migrateWechatGroupConfigsToGroupMappings();
    await this.migrateSourceContextsToGroupMappings();
  }

  async findAll(status?: string, customerCode?: string, keyword?: string) {
    await this.ensureGroupContactMappingsSchema();
    const where: string[] = ['mapping.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (status) {
      where.push('mapping.status = ?');
      params.push(status);
    }
    if (customerCode) {
      where.push('mapping.customer_code = ?');
      params.push(customerCode);
    }
    if (keyword) {
      where.push(
        [
          'mapping.group_name LIKE ?',
          'mapping.group_key LIKE ?',
          'mapping.contact_name LIKE ?',
          'mapping.group_nickname LIKE ?',
          'mapping.business_platform LIKE ?',
          'customer.customer_name LIKE ?',
        ].join(' OR '),
      );
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like, like);
    }
    return this.dataSource.query(
      `
        SELECT
          mapping.id,
          mapping.group_key,
          mapping.group_name,
          mapping.contact_name,
          mapping.group_nickname,
          NULL AS contact_mobile,
          NULL AS contact_email,
          mapping.customer_code AS customer_id,
          mapping.customer_code,
          mapping.business_platform,
          mapping.collect_enabled,
          mapping.nickname_updated,
          mapping.status,
          mapping.remark,
          mapping.created_at,
          mapping.updated_at,
          mapping.deleted_at,
          customer.customer_name
        FROM group_contact_mappings mapping
        JOIN customers customer
          ON customer.customer_code = mapping.customer_code
         AND customer.deleted_at IS NULL
        WHERE ${where.map((item) => `(${item})`).join(' AND ')}
        ORDER BY mapping.group_name ASC, mapping.contact_name ASC, mapping.updated_at DESC
        LIMIT 500
      `,
      params,
    );
  }

  async findOne(id: string) {
    await this.ensureGroupContactMappingsSchema();
    const rows = await this.dataSource.query(
      `
        SELECT
          mapping.id,
          mapping.group_key,
          mapping.group_name,
          mapping.contact_name,
          mapping.group_nickname,
          NULL AS contact_mobile,
          NULL AS contact_email,
          mapping.customer_code AS customer_id,
          mapping.customer_code,
          mapping.business_platform,
          mapping.collect_enabled,
          mapping.nickname_updated,
          mapping.status,
          mapping.remark,
          mapping.created_at,
          mapping.updated_at,
          mapping.deleted_at
        FROM group_contact_mappings mapping
        JOIN customers customer
          ON customer.customer_code = mapping.customer_code
         AND customer.deleted_at IS NULL
        WHERE mapping.id = ?
          AND mapping.deleted_at IS NULL
        LIMIT 1
      `,
      [id],
    );
    if (!rows?.[0]) {
      throw new NotFoundException('Contact context config not found');
    }
    return rows[0];
  }

  async listSourceContexts(status?: string, keyword?: string) {
    await this.ensureGroupContactMappingsSchema();
    const where: string[] = ['mapping.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (status) {
      where.push('mapping.status = ?');
      params.push(status);
    }
    if (keyword) {
      where.push(
        [
          'mapping.group_name LIKE ?',
          'mapping.group_key LIKE ?',
          'mapping.contact_name LIKE ?',
          'mapping.group_nickname LIKE ?',
          'customer.customer_name LIKE ?',
        ].join(' OR '),
      );
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like);
    }
    return this.dataSource.query(
      `
        SELECT
          mapping.id,
          'crawler' AS source_app,
          'wechat_group' AS source_type,
          mapping.group_key AS source_key,
          mapping.group_name AS source_name,
          mapping.group_key AS external_source_id,
          mapping.id AS contact_context_config_id,
          mapping.status,
          1 AS is_primary,
          100 AS priority,
          'group_contact_mapping' AS match_method,
          mapping.remark,
          mapping.created_at AS first_seen_at,
          mapping.updated_at AS last_seen_at,
          mapping.created_at,
          mapping.updated_at,
          mapping.deleted_at,
          mapping.contact_name,
          mapping.group_nickname,
          mapping.customer_code AS customer_id,
          mapping.customer_code,
          mapping.business_platform,
          customer.customer_name
        FROM group_contact_mappings mapping
        JOIN customers customer
          ON customer.customer_code = mapping.customer_code
         AND customer.deleted_at IS NULL
        WHERE ${where.map((item) => `(${item})`).join(' AND ')}
        ORDER BY mapping.group_name ASC, mapping.contact_name ASC, mapping.updated_at DESC
        LIMIT 500
      `,
      params,
    );
  }

  async listWechatGroupConfigs(status?: string, keyword?: string) {
    await this.ensureGroupContactMappingsSchema();
    const where: string[] = ['mapping.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (status) {
      where.push('mapping.status = ?');
      params.push(status);
    }
    if (keyword) {
      where.push(
        [
          'mapping.group_name LIKE ?',
          'mapping.group_key LIKE ?',
          'customer.customer_name LIKE ?',
          'mapping.contact_name LIKE ?',
          'mapping.group_nickname LIKE ?',
          'mapping.business_platform LIKE ?',
        ].join(' OR '),
      );
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like, like);
    }
    return this.dataSource.query(
      `
        SELECT
          mapping.id,
          mapping.group_key AS group_id,
          mapping.group_name,
          mapping.group_key AS source_key,
          mapping.group_nickname,
          mapping.customer_code AS customer_id,
          mapping.customer_code,
          mapping.id AS contact_context_config_id,
          mapping.business_platform,
          mapping.status,
          mapping.collect_enabled,
          mapping.nickname_updated,
          100 AS sort_order,
          mapping.remark,
          mapping.created_at,
          mapping.updated_at,
          mapping.deleted_at,
          customer.customer_name,
          mapping.contact_name,
          mapping.business_platform AS resolved_business_platform
        FROM group_contact_mappings mapping
        JOIN customers customer
          ON customer.customer_code = mapping.customer_code
         AND customer.deleted_at IS NULL
        WHERE ${where.map((item) => `(${item})`).join(' AND ')}
        ORDER BY mapping.group_name ASC, mapping.contact_name ASC, mapping.updated_at DESC
        LIMIT 500
      `,
      params,
    );
  }

  async createWechatGroupConfig(dto: CreateWechatGroupConfigDto) {
    await this.ensureGroupContactMappingsSchema();
    const customerCode = await this.resolveCustomerCodeInput(
      dto.customerCode,
      dto.customerId,
    );
    let existingContext: Record<string, unknown> | null = null;
    if (dto.contactContextConfigId) {
      existingContext = await this.findOne(dto.contactContextConfigId);
    }
    const contactName =
      dto.contactName ?? String(existingContext?.contact_name ?? '').trim();
    if (!contactName) {
      throw new BadRequestException('Contact name is required');
    }
    const groupKey = dto.groupId || (await this.nextGroupKey(customerCode));
    const saved = await this.upsertGroupContactMapping({
      id: dto.contactContextConfigId,
      groupKey,
      groupName: dto.groupName,
      contactName,
      groupNickname: this.normalizeNullableText(dto.groupNickname),
      customerCode,
      businessPlatform:
        dto.businessPlatform ??
        this.normalizeNullableText(existingContext?.business_platform),
      collectEnabled:
        dto.collectEnabled === undefined ? true : dto.collectEnabled,
      nicknameUpdated: dto.nicknameUpdated === true,
      status: dto.status ?? 'active',
      remark: dto.remark ?? null,
    });
    return this.toWechatGroupConfigShape(saved);
  }

  async updateWechatGroupConfig(id: string, dto: UpdateWechatGroupConfigDto) {
    await this.ensureGroupContactMappingsSchema();
    const current = await this.findOne(id);
    const updates: string[] = [];
    const params: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      updates.push(`${column} = ?`);
      params.push(value);
    };

    if (dto.groupId !== undefined) assign('group_key', dto.groupId);
    if (dto.groupName !== undefined) assign('group_name', dto.groupName);
    if (dto.contactName !== undefined) assign('contact_name', dto.contactName);
    if (dto.groupNickname !== undefined) {
      assign('group_nickname', this.normalizeNullableText(dto.groupNickname));
    }
    if (dto.customerCode !== undefined || dto.customerId !== undefined) {
      assign(
        'customer_code',
        await this.resolveCustomerCodeInput(dto.customerCode, dto.customerId),
      );
    }
    if (dto.businessPlatform !== undefined) {
      assign('business_platform', this.normalizeNullableText(dto.businessPlatform));
    }
    if (dto.collectEnabled !== undefined) {
      assign('collect_enabled', dto.collectEnabled ? 1 : 0);
    } else if (dto.status !== undefined) {
      assign('collect_enabled', dto.status === 'active' ? 1 : 0);
    }
    if (dto.nicknameUpdated !== undefined) {
      assign('nickname_updated', dto.nicknameUpdated ? 1 : 0);
    }
    if (dto.status !== undefined) assign('status', dto.status);
    if (dto.remark !== undefined) assign('remark', dto.remark ?? null);

    if (!updates.length) return this.toWechatGroupConfigShape(current);

    await this.dataSource.query(
      `
        UPDATE group_contact_mappings
        SET ${updates.join(', ')},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL
      `,
      [...params, id],
    );

    return this.toWechatGroupConfigShape(await this.findOne(id));
  }

  async deleteWechatGroupConfig(id: string) {
    await this.ensureGroupContactMappingsSchema();
    const current = await this.findOne(id);
    await this.dataSource.query(
      `
        UPDATE group_contact_mappings
        SET deleted_at = CURRENT_TIMESTAMP,
            status = 'deleted',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL
      `,
      [id],
    );
    return {
      success: true,
      id,
      groupName: current.group_name,
    };
  }

  async createSourceContext(dto: CreateSourceContactContextDto) {
    await this.ensureGroupContactMappingsSchema();
    const context = await this.findOne(dto.contactContextConfigId);
    const groupKey =
      dto.sourceKey || dto.externalSourceId || this.makeGroupKey(dto.sourceName);
    const saved = await this.upsertGroupContactMapping({
      id: dto.contactContextConfigId,
      groupKey,
      groupName: dto.sourceName,
      contactName: String(context.contact_name),
      customerCode: String(context.customer_code),
      businessPlatform: this.normalizeNullableText(context.business_platform),
      collectEnabled: true,
      status: 'active',
      remark: dto.remark ?? null,
    });
    return this.toSourceContextShape(saved);
  }

  async updateSourceContext(id: string, dto: UpdateSourceContactContextDto) {
    await this.ensureGroupContactMappingsSchema();
    const current = await this.findOne(id);
    const context = dto.contactContextConfigId
      ? await this.findOne(dto.contactContextConfigId)
      : current;
    const saved = await this.upsertGroupContactMapping({
      id,
      groupKey: dto.externalSourceId ?? String(current.group_key),
      groupName: dto.sourceName ?? String(current.group_name),
      contactName: String(context.contact_name),
      customerCode: String(context.customer_code),
      businessPlatform: this.normalizeNullableText(context.business_platform),
      collectEnabled: true,
      status: dto.status ?? String(current.status),
      remark: dto.remark ?? (current.remark as string | null),
    });
    return this.toSourceContextShape(saved);
  }

  async create(dto: CreateContactContextConfigDto) {
    await this.ensureGroupContactMappingsSchema();
    const customerCode = await this.resolveCustomerCodeInput(
      dto.customerCode,
      dto.customerId,
    );
    return this.upsertGroupContactMapping({
      groupKey: dto.groupKey || this.makeGroupKey(dto.groupName || dto.contactName),
      groupName: dto.groupName || dto.contactName,
      contactName: dto.contactName,
      customerCode,
      businessPlatform: this.normalizeNullableText(dto.businessPlatform),
      collectEnabled: true,
      status: 'active',
      remark: dto.remark ?? null,
    });
  }

  async update(id: string, dto: UpdateContactContextConfigDto) {
    await this.ensureGroupContactMappingsSchema();
    const config = await this.findOne(id);
    const customerCode =
      dto.customerCode || dto.customerId
        ? await this.resolveCustomerCodeInput(dto.customerCode, dto.customerId)
        : String(config.customer_code);
    return this.upsertGroupContactMapping({
      id,
      groupKey: dto.groupKey ?? String(config.group_key),
      groupName: dto.groupName ?? String(config.group_name),
      contactName: dto.contactName ?? String(config.contact_name),
      customerCode,
      businessPlatform:
        dto.businessPlatform !== undefined
          ? this.normalizeNullableText(dto.businessPlatform)
          : this.normalizeNullableText(config.business_platform),
      collectEnabled: Boolean(config.collect_enabled),
      status: dto.status ?? config.status,
      remark: dto.remark ?? config.remark,
    });
  }

  private async ensureGroupContactMappingsSchema() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS group_contact_mappings (
        id CHAR(36) NOT NULL,
        group_key VARCHAR(255) NOT NULL,
        group_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(64) NOT NULL,
        group_nickname VARCHAR(128) NULL,
        customer_code VARCHAR(32) NOT NULL,
        business_platform VARCHAR(64) NULL,
        collect_enabled TINYINT(1) NOT NULL DEFAULT 1,
        nickname_updated TINYINT(1) NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        remark VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_group_contact_mapping (group_key, contact_name),
        KEY idx_group_contact_group (group_key),
        KEY idx_group_contact_name (contact_name),
        KEY idx_group_contact_customer_platform (customer_code, business_platform),
        KEY idx_group_contact_status (status, collect_enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='群内对接人映射表'
    `);
    await this.addColumnIfMissing(
      'group_contact_mappings',
      'customer_code',
      'VARCHAR(32) NULL',
    );
    await this.backfillGroupContactCustomerCodes();
    await this.addColumnIfMissing(
      'group_contact_mappings',
      'group_nickname',
      'VARCHAR(128) NULL AFTER contact_name',
    );
    await this.modifyColumnIfNeeded(
      'group_contact_mappings',
      'customer_code',
      'VARCHAR(32) NOT NULL',
    );
    await this.addColumnIfMissing(
      'group_contact_mappings',
      'nickname_updated',
      'TINYINT(1) NOT NULL DEFAULT 0 AFTER collect_enabled',
    );
    await this.dropForeignKeyIfExists(
      'group_contact_mappings',
      'fk_group_contact_customer',
    );
    await this.dropIndexIfExists(
      'group_contact_mappings',
      'idx_group_contact_customer_platform',
    );
    await this.dropColumnIfExists('group_contact_mappings', 'customer_id');
    await ensureIndex(
      this.dataSource,
      'group_contact_mappings',
      'idx_group_contact_customer_platform',
      ['customer_code', 'business_platform'],
    );
  }

  private async upsertGroupContactMapping(input: {
    id?: string | null;
    groupKey: string;
    groupName: string;
    contactName: string;
    groupNickname?: string | null;
    customerCode: string;
    businessPlatform?: string | null;
    collectEnabled?: boolean;
    nicknameUpdated?: boolean;
    status?: string;
    remark?: string | null;
  }) {
    const groupKey = String(input.groupKey || '').trim();
    const groupName = String(input.groupName || '').trim();
    const contactName = String(input.contactName || '').trim();
    if (!groupKey || !groupName || !contactName) {
      throw new BadRequestException('Group and contact are required');
    }
    await this.ensureCustomerCode(input.customerCode);
    const nicknameUpdated = await this.resolveNicknameUpdated(input);
    await this.dataSource.query(
      `
        INSERT INTO group_contact_mappings (
          id,
          group_key,
          group_name,
          contact_name,
          group_nickname,
          customer_code,
          business_platform,
          collect_enabled,
          nickname_updated,
          status,
          remark
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          group_name = VALUES(group_name),
          group_nickname = VALUES(group_nickname),
          customer_code = VALUES(customer_code),
          business_platform = VALUES(business_platform),
          collect_enabled = VALUES(collect_enabled),
          nickname_updated = VALUES(nickname_updated),
          status = VALUES(status),
          remark = VALUES(remark),
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        input.id || randomUUID(),
        groupKey,
        groupName,
        contactName,
        input.groupNickname || null,
        input.customerCode,
        input.businessPlatform || null,
        input.collectEnabled === false ? 0 : 1,
        nicknameUpdated ? 1 : 0,
        input.status || 'active',
        input.remark ?? null,
      ],
    );
    const rows = await this.dataSource.query(
      `
        SELECT
          mapping.*,
          mapping.customer_code AS customer_id,
          customer.customer_name
        FROM group_contact_mappings mapping
        JOIN customers customer
          ON customer.customer_code = mapping.customer_code
         AND customer.deleted_at IS NULL
        WHERE mapping.group_key = ?
          AND mapping.contact_name = ?
          AND mapping.deleted_at IS NULL
        LIMIT 1
      `,
      [groupKey, contactName],
    );
    return rows[0];
  }

  private async resolveNicknameUpdated(input: {
    id?: string | null;
    groupKey: string;
    contactName: string;
    nicknameUpdated?: boolean;
  }) {
    if (input.nicknameUpdated !== undefined) {
      return input.nicknameUpdated;
    }
    const rows = await this.dataSource.query(
      `
        SELECT nickname_updated AS nicknameUpdated
        FROM group_contact_mappings
        WHERE ${
          input.id
            ? 'id = ?'
            : 'group_key = ? AND contact_name = ?'
        }
        LIMIT 1
      `,
      input.id ? [input.id] : [input.groupKey, input.contactName],
    );
    return Boolean(rows?.[0]?.nicknameUpdated);
  }

  private async nextGroupKey(customerCode: string) {
    const code = this.groupKeyCustomerCode(customerCode);
    const prefix = `group_${code}`;
    const rows = await this.dataSource.query(
      `
        SELECT group_key AS groupKey
        FROM group_contact_mappings
        WHERE group_key LIKE ?
        LIMIT 1000
      `,
      [`${prefix}_%`],
    );
    const pattern = new RegExp(`^${this.escapeRegExp(prefix)}_(\\d+)$`);
    const maxNo = rows.reduce((max: number, row: Record<string, unknown>) => {
      const match = pattern.exec(String(row.groupKey ?? ''));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const nextNo = maxNo + 1;
    return `${prefix}_${String(nextNo).padStart(3, '0')}`;
  }

  private groupKeyCustomerCode(customerCode: string) {
    const normalized = String(customerCode || '')
      .trim()
      .toLowerCase()
      .replace(/基金$/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || 'fund';
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async backfillGroupContactCustomerCodes() {
    if (!(await this.columnExists('group_contact_mappings', 'customer_id'))) {
      return;
    }
    await this.dataSource.query(`
      UPDATE group_contact_mappings mapping
      JOIN customers customer
        ON customer.id = mapping.customer_id
       AND customer.deleted_at IS NULL
      SET mapping.customer_code = customer.customer_code
      WHERE (mapping.customer_code IS NULL OR mapping.customer_code = '')
        AND customer.customer_code IS NOT NULL
        AND customer.customer_code <> ''
    `);
  }

  private async customerCodeForId(customerId: string) {
    const customer = await this.customersRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
    const customerCode = this.normalizeNullableText(customer.customer_code);
    if (!customerCode) {
      throw new BadRequestException('Customer code is required');
    }
    return customerCode;
  }

  private async ensureCustomerCode(customerCode: string) {
    const customer = await this.customersRepository.findOne({
      where: { customer_code: customerCode },
    });
    if (!customer) {
      throw new BadRequestException('Customer code not found');
    }
  }

  private async resolveCustomerCodeInput(
    customerCode?: string,
    legacyCustomerId?: string,
  ) {
    const normalizedCode = this.normalizeNullableText(customerCode);
    if (normalizedCode) {
      await this.ensureCustomerCode(normalizedCode);
      return normalizedCode;
    }
    const normalizedId = this.normalizeNullableText(legacyCustomerId);
    if (!normalizedId) {
      throw new BadRequestException('Customer code is required');
    }
    if (await this.customerCodeExists(normalizedId)) {
      return normalizedId;
    }
    return this.customerCodeForId(normalizedId);
  }

  private async customerCodeExists(customerCode: string) {
    const customer = await this.customersRepository.findOne({
      where: { customer_code: customerCode },
    });
    return Boolean(customer);
  }

  private normalizeNullableText(value: unknown) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private toWechatGroupConfigShape(mapping: Record<string, unknown>) {
    return {
      id: mapping.id,
      group_id: mapping.group_key,
      group_name: mapping.group_name,
      source_key: mapping.group_key,
      customer_id: mapping.customer_code,
      customer_code: mapping.customer_code,
      contact_context_config_id: mapping.id,
      business_platform: mapping.business_platform,
      status: mapping.status,
      collect_enabled: mapping.collect_enabled,
      nickname_updated: mapping.nickname_updated,
      sort_order: 100,
      remark: mapping.remark,
      created_at: mapping.created_at,
      updated_at: mapping.updated_at,
      deleted_at: mapping.deleted_at,
      contact_name: mapping.contact_name,
      group_nickname: mapping.group_nickname,
      resolved_business_platform: mapping.business_platform,
    };
  }

  private toSourceContextShape(mapping: Record<string, unknown>) {
    return {
      id: mapping.id,
      source_app: 'crawler',
      source_type: 'wechat_group',
      source_key: mapping.group_key,
      source_name: mapping.group_name,
      external_source_id: mapping.group_key,
      contact_context_config_id: mapping.id,
      status: mapping.status,
      is_primary: 1,
      priority: 100,
      match_method: 'group_contact_mapping',
      remark: mapping.remark,
      first_seen_at: mapping.created_at,
      last_seen_at: mapping.updated_at,
      created_at: mapping.created_at,
      updated_at: mapping.updated_at,
      deleted_at: mapping.deleted_at,
      contact_name: mapping.contact_name,
      group_nickname: mapping.group_nickname,
      customer_id: mapping.customer_code,
      customer_code: mapping.customer_code,
      business_platform: mapping.business_platform,
    };
  }

  private makeGroupKey(groupName: string) {
    return createHash('sha256')
      .update(`group:${String(groupName || '').trim()}`, 'utf8')
      .digest('hex');
  }

  private async tableExists(tableName: string) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = ?
      `,
      [tableName],
    );
    return Number(rows?.[0]?.count || 0) > 0;
  }

  private async migrateLegacyContactContextsToGroupMappings() {
    if (!(await this.tableExists('contact_context_configs'))) return;
    await this.dataSource.query(`
      INSERT IGNORE INTO group_contact_mappings (
        id,
        group_key,
        group_name,
        contact_name,
        customer_code,
        business_platform,
        collect_enabled,
        status,
        remark,
        created_at,
        updated_at,
        deleted_at
      )
      SELECT
        context.id,
        SHA2(CONCAT('legacy:', context.id), 256),
        COALESCE(NULLIF(context.remark, ''), context.contact_name),
        context.contact_name,
        customer.customer_code,
        context.business_platform,
        1,
        context.status,
        context.remark,
        context.created_at,
        context.updated_at,
        context.deleted_at
      FROM contact_context_configs context
      JOIN customers customer
        ON customer.id = context.customer_id
       AND customer.deleted_at IS NULL
      WHERE context.deleted_at IS NULL
    `);
  }

  private async migrateWechatGroupConfigsToGroupMappings() {
    if (!(await this.tableExists('wechat_group_configs'))) return;
    await this.dataSource.query(`
      INSERT IGNORE INTO group_contact_mappings (
        id,
        group_key,
        group_name,
        contact_name,
        customer_code,
        business_platform,
        collect_enabled,
        status,
        remark,
        created_at,
        updated_at,
        deleted_at
      )
      SELECT
        UUID(),
        COALESCE(NULLIF(group_config.group_id, ''), group_config.source_key, SHA2(CONCAT('group:', group_config.group_name), 256)),
        group_config.group_name,
        COALESCE(context.contact_name, group_config.group_name),
        customer.customer_code,
        COALESCE(group_config.business_platform, context.business_platform),
        COALESCE(group_config.collect_enabled, 1),
        group_config.status,
        group_config.remark,
        group_config.created_at,
        group_config.updated_at,
        group_config.deleted_at
      FROM wechat_group_configs group_config
      JOIN customers customer
        ON customer.id = group_config.customer_id
       AND customer.deleted_at IS NULL
      LEFT JOIN contact_context_configs context
        ON context.id = group_config.contact_context_config_id
       AND context.deleted_at IS NULL
      WHERE group_config.deleted_at IS NULL
    `);
  }

  private async migrateSourceContextsToGroupMappings() {
    if (!(await this.tableExists('source_contact_contexts'))) return;
    await this.dataSource.query(`
      INSERT IGNORE INTO group_contact_mappings (
        id,
        group_key,
        group_name,
        contact_name,
        customer_code,
        business_platform,
        collect_enabled,
        status,
        remark,
        created_at,
        updated_at,
        deleted_at
      )
      SELECT
        UUID(),
        source.source_key,
        source.source_name,
        context.contact_name,
        customer.customer_code,
        context.business_platform,
        1,
        source.status,
        source.remark,
        source.created_at,
        source.updated_at,
        source.deleted_at
      FROM source_contact_contexts source
      JOIN contact_context_configs context
        ON context.id = source.contact_context_config_id
       AND context.deleted_at IS NULL
      JOIN customers customer
        ON customer.id = context.customer_id
       AND customer.deleted_at IS NULL
      WHERE source.deleted_at IS NULL
        AND source.source_type IN ('wechat_group', 'crawler_chat', 'chat')
    `);
  }

  private async ensureCustomer(customerId: string) {
    const customer = await this.customersRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
  }

  private async ensureContactContextSchema() {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = 'contact_context_configs'
      `,
    );
    if (Number(rows?.[0]?.count || 0) === 0) return;
    await this.dropColumnIfExists(
      'contact_context_configs',
      'business_category',
    );
    await this.dropColumnIfExists(
      'contact_context_configs',
      'secondary_category',
    );
    await this.dropColumnIfExists(
      'contact_context_configs',
      'tertiary_category',
    );
    await ensureIndex(
      this.dataSource,
      'contact_context_configs',
      'idx_contact_context_customer_status',
      ['customer_id', 'status'],
    );
    await ensureIndex(
      this.dataSource,
      'contact_context_configs',
      'idx_contact_context_name',
      ['contact_name'],
    );
    await ensureIndex(
      this.dataSource,
      'contact_context_configs',
      'idx_contact_context_platform',
      ['business_platform'],
    );
  }

  private makeSourceKey(
    sourceType: string,
    sourceName: string,
    externalSourceId?: string,
  ) {
    const identity = externalSourceId || sourceName;
    return createHash('sha256')
      .update(`${sourceType}:${identity}`, 'utf8')
      .digest('hex');
  }

  private async findWechatGroupConfigById(id: string) {
    const rows = await this.dataSource.query(
      `
        SELECT
          group_config.*,
          customer.customer_name,
          context.contact_name,
          COALESCE(group_config.business_platform, context.business_platform) AS resolved_business_platform
        FROM wechat_group_configs group_config
        JOIN customers customer
          ON customer.id = group_config.customer_id
         AND customer.deleted_at IS NULL
        LEFT JOIN contact_context_configs context
          ON context.id = group_config.contact_context_config_id
         AND context.deleted_at IS NULL
        WHERE group_config.id = ?
        LIMIT 1
      `,
      [id],
    );
    if (!rows?.[0]) {
      throw new NotFoundException('Wechat group config not found');
    }
    return rows[0];
  }

  private async findWechatGroupConfigBySourceKey(sourceKey: string) {
    const rows = await this.dataSource.query(
      `
        SELECT
          group_config.*,
          customer.customer_name,
          context.contact_name,
          COALESCE(group_config.business_platform, context.business_platform) AS resolved_business_platform
        FROM wechat_group_configs group_config
        JOIN customers customer
          ON customer.id = group_config.customer_id
         AND customer.deleted_at IS NULL
        LEFT JOIN contact_context_configs context
          ON context.id = group_config.contact_context_config_id
         AND context.deleted_at IS NULL
        WHERE group_config.source_key = ?
        LIMIT 1
      `,
      [sourceKey],
    );
    return rows?.[0] ?? null;
  }

  private async ensureWechatGroupConfigSchema() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS wechat_group_configs (
        id CHAR(36) NOT NULL,
        group_id VARCHAR(128) NULL,
        group_name VARCHAR(255) NOT NULL,
        source_key CHAR(64) NOT NULL,
        customer_id CHAR(36) NOT NULL,
        contact_context_config_id CHAR(36) NULL,
        business_platform VARCHAR(64) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        collect_enabled TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 100,
        remark VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_wechat_group_source (source_key),
        UNIQUE KEY uk_wechat_group_id (group_id),
        KEY idx_wechat_group_customer (customer_id),
        KEY idx_wechat_group_contact (contact_context_config_id),
        KEY idx_wechat_group_status_order (status, collect_enabled, sort_order),
        CONSTRAINT fk_wechat_group_customer
          FOREIGN KEY (customer_id)
          REFERENCES customers(id),
        CONSTRAINT fk_wechat_group_contact_context
          FOREIGN KEY (contact_context_config_id)
          REFERENCES contact_context_configs(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='微信群采集配置表'
    `);
    await this.addColumnIfMissing(
      'wechat_group_configs',
      'source_key',
      'CHAR(64) NULL',
    );
    await this.backfillWechatGroupSourceKeys();
    await this.modifyColumnIfNeeded(
      'wechat_group_configs',
      'source_key',
      'CHAR(64) NOT NULL',
    );
    await this.addColumnIfMissing(
      'wechat_group_configs',
      'collect_enabled',
      'TINYINT(1) NOT NULL DEFAULT 1',
    );
    await this.addColumnIfMissing(
      'wechat_group_configs',
      'sort_order',
      'INT NOT NULL DEFAULT 100',
    );
    await this.addColumnIfMissing(
      'wechat_group_configs',
      'contact_context_config_id',
      'CHAR(36) NULL',
    );
    await this.addColumnIfMissing(
      'wechat_group_configs',
      'business_platform',
      'VARCHAR(64) NULL',
    );
    await this.ensureUniqueIndex('wechat_group_configs', 'uk_wechat_group_source', [
      'source_key',
    ]);
    await this.ensureUniqueIndex('wechat_group_configs', 'uk_wechat_group_id', [
      'group_id',
    ]);
    await ensureIndex(this.dataSource, 'wechat_group_configs', 'idx_wechat_group_customer', [
      'customer_id',
    ]);
    await ensureIndex(this.dataSource, 'wechat_group_configs', 'idx_wechat_group_contact', [
      'contact_context_config_id',
    ]);
    await ensureIndex(
      this.dataSource,
      'wechat_group_configs',
      'idx_wechat_group_status_order',
      ['status', 'collect_enabled', 'sort_order'],
    );
    await this.migrateSourceContextsToWechatGroupConfigs();
  }

  private async backfillWechatGroupSourceKeys() {
    const rows = await this.dataSource.query(
      `
        SELECT id, group_id, group_name
        FROM wechat_group_configs
        WHERE source_key IS NULL OR source_key = ''
      `,
    );
    for (const row of rows) {
      await this.dataSource.query(
        'UPDATE wechat_group_configs SET source_key = ? WHERE id = ?',
        [
          this.makeSourceKey(
            'wechat_group',
            String(row.group_name),
            row.group_id ?? undefined,
          ),
          row.id,
        ],
      );
    }
  }

  private async migrateSourceContextsToWechatGroupConfigs() {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = 'source_contact_contexts'
      `,
    );
    if (Number(rows?.[0]?.count || 0) === 0) return;
    await this.dataSource.query(
      `
        INSERT IGNORE INTO wechat_group_configs (
          id, group_id, group_name, source_key, customer_id,
          contact_context_config_id, business_platform, status,
          collect_enabled, sort_order, remark
        )
        SELECT
          UUID(),
          source.external_source_id,
          source.source_name,
          source.source_key,
          context.customer_id,
          source.contact_context_config_id,
          context.business_platform,
          'active',
          1,
          COALESCE(source.priority, 100),
          'migrated from source_contact_contexts'
        FROM source_contact_contexts source
        JOIN contact_context_configs context
          ON context.id = source.contact_context_config_id
         AND context.deleted_at IS NULL
        WHERE source.source_type = 'wechat_group'
          AND source.status = 'active'
          AND source.deleted_at IS NULL
      `,
    );
  }

  private async ensureSourceContactContextSchema() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS source_contact_contexts (
        id CHAR(36) NOT NULL,
        source_app VARCHAR(32) NOT NULL DEFAULT 'crawler',
        source_type VARCHAR(32) NOT NULL,
        source_key CHAR(64) NOT NULL,
        source_name VARCHAR(255) NOT NULL,
        external_source_id VARCHAR(128) NULL,
        contact_context_config_id CHAR(36) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        is_primary TINYINT(1) NOT NULL DEFAULT 1,
        priority INT NOT NULL DEFAULT 100,
        match_method VARCHAR(32) NULL,
        remark VARCHAR(255) NULL,
        first_seen_at DATETIME NULL,
        last_seen_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_source_contact_context_config (source_app, source_type, source_key, contact_context_config_id),
        KEY idx_source_contact_source (source_app, source_type, source_key),
        KEY idx_source_contact_name (source_name),
        KEY idx_source_contact_config (contact_context_config_id),
        KEY idx_source_contact_status (status),
        KEY idx_source_contact_priority (source_app, source_type, source_key, status, is_primary, priority),
        CONSTRAINT fk_source_contact_context_config
          FOREIGN KEY (contact_context_config_id)
          REFERENCES contact_context_configs(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采集来源与业务上下文绑定表'
    `);
    await this.addColumnIfMissing(
      'source_contact_contexts',
      'is_primary',
      'TINYINT(1) NOT NULL DEFAULT 1',
    );
    await this.addColumnIfMissing(
      'source_contact_contexts',
      'priority',
      'INT NOT NULL DEFAULT 100',
    );
    await this.dropIndexIfExists(
      'source_contact_contexts',
      'uk_source_contact_context',
    );
    await this.ensureUniqueIndex(
      'source_contact_contexts',
      'uk_source_contact_context_config',
      [
        'source_app',
        'source_type',
        'source_key',
        'contact_context_config_id',
      ],
    );
    await ensureIndex(
      this.dataSource,
      'source_contact_contexts',
      'idx_source_contact_source',
      ['source_app', 'source_type', 'source_key'],
    );
    await ensureIndex(
      this.dataSource,
      'source_contact_contexts',
      'idx_source_contact_priority',
      [
        'source_app',
        'source_type',
        'source_key',
        'status',
        'is_primary',
        'priority',
      ],
    );
  }

  private async dropColumnIfExists(tableName: string, columnName: string) {
    if (!(await this.columnExists(tableName, columnName))) return;
    await this.dataSource.query(
      `ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``,
    );
  }

  private async columnExists(tableName: string, columnName: string) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [tableName, columnName],
    );
    return Number(rows?.[0]?.count || 0) > 0;
  }

  private async addColumnIfMissing(
    tableName: string,
    columnName: string,
    columnDefinition: string,
  ) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [tableName, columnName],
    );
    if (Number(rows?.[0]?.count || 0) > 0) return;
    await this.dataSource.query(
      `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinition}`,
    );
  }

  private async modifyColumnIfNeeded(
    tableName: string,
    columnName: string,
    columnDefinition: string,
  ) {
    const rows = await this.dataSource.query(
      `
        SELECT column_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
        LIMIT 1
      `,
      [tableName, columnName],
    );
    if (!rows?.[0]) return;
    const current = `${rows[0].column_type} ${
      rows[0].is_nullable === 'YES' ? 'NULL' : 'NOT NULL'
    }`;
    if (this.normalizeColumnDefinition(current) === this.normalizeColumnDefinition(columnDefinition)) {
      return;
    }
    await this.dataSource.query(
      `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${columnName}\` ${columnDefinition}`,
    );
  }

  private normalizeColumnDefinition(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private async dropIndexIfExists(tableName: string, indexName: string) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND index_name = ?
      `,
      [tableName, indexName],
    );
    if (Number(rows?.[0]?.count || 0) === 0) return;
    await this.dataSource.query(
      `ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``,
    );
  }

  private async dropForeignKeyIfExists(tableName: string, constraintName: string) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.table_constraints
        WHERE constraint_schema = DATABASE()
          AND table_name = ?
          AND constraint_name = ?
          AND constraint_type = 'FOREIGN KEY'
      `,
      [tableName, constraintName],
    );
    if (Number(rows?.[0]?.count || 0) === 0) return;
    await this.dataSource.query(
      `ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\``,
    );
  }

  private async ensureUniqueIndex(
    tableName: string,
    indexName: string,
    columns: string[],
  ) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND index_name = ?
      `,
      [tableName, indexName],
    );
    if (Number(rows?.[0]?.count || 0) > 0) return;
    const columnSql = columns.map((column) => `\`${column}\``).join(', ');
    await this.dataSource.query(
      `ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX \`${indexName}\` (${columnSql})`,
    );
  }

  private async demoteOtherSourceContexts(
    sourceApp: string,
    sourceType: string,
    sourceKey: string,
    contactContextConfigId: string,
  ) {
    await this.dataSource.query(
      `
        UPDATE source_contact_contexts
        SET is_primary = 0
        WHERE source_app = ?
          AND source_type = ?
          AND source_key = ?
          AND contact_context_config_id <> ?
          AND deleted_at IS NULL
      `,
      [sourceApp, sourceType, sourceKey, contactContextConfigId],
    );
  }
}
