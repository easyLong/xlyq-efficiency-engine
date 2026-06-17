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
import { ContactContextConfigEntity } from './entities/contact-context-config.entity';

@Injectable()
export class ContactContextsService implements OnModuleInit {
  constructor(
    @InjectRepository(ContactContextConfigEntity)
    private readonly configsRepository: Repository<ContactContextConfigEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customersRepository: Repository<CustomerEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureContactContextSchema();
    await this.ensureSourceContactContextSchema();
    await this.ensureWechatGroupConfigSchema();
  }

  async findAll(status?: string, customerId?: string, keyword?: string) {
    const qb = this.configsRepository.createQueryBuilder('config');
    if (status) {
      qb.andWhere('config.status = :status', { status });
    }
    if (customerId) {
      qb.andWhere('config.customer_id = :customerId', { customerId });
    }
    if (keyword) {
      qb.andWhere(
        [
          'config.contact_name LIKE :keyword',
          'config.contact_mobile LIKE :keyword',
          'config.contact_email LIKE :keyword',
          'config.business_platform LIKE :keyword',
        ].join(' OR '),
        { keyword: `%${keyword}%` },
      );
    }
    return qb.orderBy('config.created_at', 'DESC').take(500).getMany();
  }

  async findOne(id: string) {
    const config = await this.configsRepository.findOne({ where: { id } });
    if (!config) {
      throw new NotFoundException('Contact context config not found');
    }
    return config;
  }

  async listSourceContexts(status?: string, keyword?: string) {
    await this.ensureSourceContactContextSchema();
    const where: string[] = ['source.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (status) {
      where.push('source.status = ?');
      params.push(status);
    }
    if (keyword) {
      where.push(
        [
          'source.source_name LIKE ?',
          'source.source_key LIKE ?',
          'source.external_source_id LIKE ?',
          'context.contact_name LIKE ?',
          'customer.customer_name LIKE ?',
        ].join(' OR '),
      );
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like);
    }
    return this.dataSource.query(
      `
        SELECT
          source.*,
          context.contact_name,
          context.customer_id,
          context.business_platform,
          customer.customer_name
        FROM source_contact_contexts source
        JOIN contact_context_configs context
          ON context.id = source.contact_context_config_id
         AND context.deleted_at IS NULL
        JOIN customers customer
          ON customer.id = context.customer_id
         AND customer.deleted_at IS NULL
        WHERE ${where.map((item) => `(${item})`).join(' AND ')}
        ORDER BY source.source_name ASC, source.is_primary DESC, source.priority ASC, source.updated_at DESC
        LIMIT 500
      `,
      params,
    );
  }

  async listWechatGroupConfigs(status?: string, keyword?: string) {
    await this.ensureWechatGroupConfigSchema();
    const where: string[] = ['group_config.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (status) {
      where.push('group_config.status = ?');
      params.push(status);
    }
    if (keyword) {
      where.push(
        [
          'group_config.group_name LIKE ?',
          'group_config.group_id LIKE ?',
          'customer.customer_name LIKE ?',
          'context.contact_name LIKE ?',
          'group_config.business_platform LIKE ?',
        ].join(' OR '),
      );
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like);
    }
    return this.dataSource.query(
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
        WHERE ${where.map((item) => `(${item})`).join(' AND ')}
        ORDER BY group_config.sort_order ASC, group_config.updated_at DESC
        LIMIT 500
      `,
      params,
    );
  }

  async createWechatGroupConfig(dto: CreateWechatGroupConfigDto) {
    await this.ensureWechatGroupConfigSchema();
    await this.ensureCustomer(dto.customerId);
    if (dto.contactContextConfigId) {
      await this.findOne(dto.contactContextConfigId);
    }
    const sourceKey = this.makeSourceKey(
      'wechat_group',
      dto.groupName,
      dto.groupId,
    );
    await this.dataSource.query(
      `
        INSERT INTO wechat_group_configs (
          id, group_id, group_name, source_key, customer_id,
          contact_context_config_id, business_platform, status,
          collect_enabled, sort_order, remark
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          group_id = VALUES(group_id),
          group_name = VALUES(group_name),
          customer_id = VALUES(customer_id),
          contact_context_config_id = VALUES(contact_context_config_id),
          business_platform = VALUES(business_platform),
          status = 'active',
          collect_enabled = VALUES(collect_enabled),
          sort_order = VALUES(sort_order),
          remark = VALUES(remark),
          deleted_at = NULL
      `,
      [
        randomUUID(),
        dto.groupId ?? null,
        dto.groupName,
        sourceKey,
        dto.customerId,
        dto.contactContextConfigId ?? null,
        dto.businessPlatform ?? null,
        dto.collectEnabled === undefined ? 1 : dto.collectEnabled ? 1 : 0,
        dto.sortOrder ?? 100,
        dto.remark ?? null,
      ],
    );
    return this.findWechatGroupConfigBySourceKey(sourceKey);
  }

  async updateWechatGroupConfig(id: string, dto: UpdateWechatGroupConfigDto) {
    await this.ensureWechatGroupConfigSchema();
    if (dto.customerId) {
      await this.ensureCustomer(dto.customerId);
    }
    if (dto.contactContextConfigId) {
      await this.findOne(dto.contactContextConfigId);
    }
    const currentRows = await this.dataSource.query(
      'SELECT * FROM wechat_group_configs WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [id],
    );
    if (!currentRows?.[0]) {
      throw new NotFoundException('Wechat group config not found');
    }
    const current = currentRows[0];
    const nextGroupName = dto.groupName ?? current.group_name;
    const nextGroupId = dto.groupId ?? current.group_id;
    const sourceKey =
      dto.groupName !== undefined || dto.groupId !== undefined
        ? this.makeSourceKey('wechat_group', nextGroupName, nextGroupId)
        : current.source_key;
    await this.dataSource.query(
      `
        UPDATE wechat_group_configs
        SET
          group_id = COALESCE(?, group_id),
          group_name = COALESCE(?, group_name),
          source_key = ?,
          customer_id = COALESCE(?, customer_id),
          contact_context_config_id = COALESCE(?, contact_context_config_id),
          business_platform = COALESCE(?, business_platform),
          status = COALESCE(?, status),
          collect_enabled = COALESCE(?, collect_enabled),
          sort_order = COALESCE(?, sort_order),
          remark = COALESCE(?, remark),
          updated_at = NOW(),
          deleted_at = CASE WHEN ? = 'inactive' THEN deleted_at ELSE NULL END
        WHERE id = ?
      `,
      [
        dto.groupId ?? null,
        dto.groupName ?? null,
        sourceKey,
        dto.customerId ?? null,
        dto.contactContextConfigId ?? null,
        dto.businessPlatform ?? null,
        dto.status ?? null,
        dto.collectEnabled === undefined ? null : dto.collectEnabled ? 1 : 0,
        dto.sortOrder ?? null,
        dto.remark ?? null,
        dto.status ?? null,
        id,
      ],
    );
    return this.findWechatGroupConfigById(id);
  }

  async createSourceContext(dto: CreateSourceContactContextDto) {
    await this.ensureSourceContactContextSchema();
    await this.findOne(dto.contactContextConfigId);
    const sourceApp = dto.sourceApp || 'crawler';
    const sourceKey =
      dto.sourceKey ||
      this.makeSourceKey(
        dto.sourceType,
        dto.sourceName,
        dto.externalSourceId,
      );
    await this.dataSource.query(
      `
        INSERT INTO source_contact_contexts (
          id, source_app, source_type, source_key, source_name,
          external_source_id, contact_context_config_id, status,
          is_primary, priority, match_method, remark, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          source_name = VALUES(source_name),
          external_source_id = VALUES(external_source_id),
          status = 'active',
          is_primary = VALUES(is_primary),
          priority = VALUES(priority),
          match_method = VALUES(match_method),
          remark = VALUES(remark),
          last_seen_at = VALUES(last_seen_at),
          deleted_at = NULL
      `,
      [
        randomUUID(),
        sourceApp,
        dto.sourceType,
        sourceKey,
        dto.sourceName,
        dto.externalSourceId ?? null,
        dto.contactContextConfigId,
        (dto.isPrimary ?? true) ? 1 : 0,
        dto.priority ?? 100,
        dto.matchMethod ?? 'manual',
        dto.remark ?? null,
      ],
    );
    if (dto.isPrimary ?? true) {
      await this.demoteOtherSourceContexts(
        sourceApp,
        dto.sourceType,
        sourceKey,
        dto.contactContextConfigId,
      );
    }
    const rows = await this.dataSource.query(
      `
        SELECT *
        FROM source_contact_contexts
        WHERE source_app = ? AND source_type = ? AND source_key = ?
          AND contact_context_config_id = ?
        LIMIT 1
      `,
      [sourceApp, dto.sourceType, sourceKey, dto.contactContextConfigId],
    );
    return rows?.[0] ?? null;
  }

  async updateSourceContext(id: string, dto: UpdateSourceContactContextDto) {
    await this.ensureSourceContactContextSchema();
    if (dto.contactContextConfigId) {
      await this.findOne(dto.contactContextConfigId);
    }
    await this.dataSource.query(
      `
        UPDATE source_contact_contexts
        SET
          source_name = COALESCE(?, source_name),
          external_source_id = COALESCE(?, external_source_id),
          contact_context_config_id = COALESCE(?, contact_context_config_id),
          status = COALESCE(?, status),
          is_primary = COALESCE(?, is_primary),
          priority = COALESCE(?, priority),
          match_method = COALESCE(?, match_method),
          remark = COALESCE(?, remark),
          last_seen_at = NOW(),
          updated_at = NOW(),
          deleted_at = CASE WHEN ? = 'inactive' THEN deleted_at ELSE NULL END
        WHERE id = ?
      `,
      [
        dto.sourceName ?? null,
        dto.externalSourceId ?? null,
        dto.contactContextConfigId ?? null,
        dto.status ?? null,
        dto.isPrimary === undefined ? null : dto.isPrimary ? 1 : 0,
        dto.priority ?? null,
        dto.matchMethod ?? null,
        dto.remark ?? null,
        dto.status ?? null,
        id,
      ],
    );
    const rows = await this.dataSource.query(
      'SELECT * FROM source_contact_contexts WHERE id = ? LIMIT 1',
      [id],
    );
    if (!rows?.[0]) {
      throw new NotFoundException('Source contact context not found');
    }
    if (dto.isPrimary) {
      await this.demoteOtherSourceContexts(
        rows[0].source_app,
        rows[0].source_type,
        rows[0].source_key,
        rows[0].contact_context_config_id,
      );
    }
    return rows[0];
  }

  async create(dto: CreateContactContextConfigDto) {
    await this.ensureCustomer(dto.customerId);
    const config = this.configsRepository.create({
      id: randomUUID(),
      contact_name: dto.contactName,
      contact_mobile: dto.contactMobile ?? null,
      contact_email: dto.contactEmail ?? null,
      customer_id: dto.customerId,
      business_platform: dto.businessPlatform ?? null,
      status: 'active',
      remark: dto.remark ?? null,
    });
    return this.configsRepository.save(config);
  }

  async update(id: string, dto: UpdateContactContextConfigDto) {
    const config = await this.findOne(id);
    if (dto.customerId) {
      await this.ensureCustomer(dto.customerId);
    }
    Object.assign(config, {
      contact_name: dto.contactName ?? config.contact_name,
      contact_mobile: dto.contactMobile ?? config.contact_mobile,
      contact_email: dto.contactEmail ?? config.contact_email,
      customer_id: dto.customerId ?? config.customer_id,
      business_platform: dto.businessPlatform ?? config.business_platform,
      status: dto.status ?? config.status,
      remark: dto.remark ?? config.remark,
    });
    return this.configsRepository.save(config);
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
    if (Number(rows?.[0]?.count || 0) === 0) return;
    await this.dataSource.query(
      `ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``,
    );
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
