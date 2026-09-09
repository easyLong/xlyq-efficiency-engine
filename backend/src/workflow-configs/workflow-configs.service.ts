import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ensureWorkflowConfigTables } from '../common/workflow-config-schema';

export const CUSTOMER_WORKFLOW_ROLES = [
  'dispatcher',
  'customer_reviewer',
] as const;

export type CustomerWorkflowRole = (typeof CUSTOMER_WORKFLOW_ROLES)[number];

const businessCategories = [
  { code: 'design', name: '设计' },
  { code: 'operation', name: '运营' },
  { code: 'content', name: '内容' },
] as const;

@Injectable()
export class WorkflowConfigsService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    await ensureWorkflowConfigTables(this.dataSource);
    await this.migrateLegacyMappings();
    await this.seedDefaultReportRecipients();
  }

  async findAll() {
    const [customerMembers, businessCategoryReviewers, globalMembers] =
      await Promise.all([
        this.dataSource.query(`
        SELECT
          member.id,
          member.customer_code AS customerCode,
          customer.customer_name AS customerName,
          member.role_code AS roleCode,
          member.user_id AS userId,
          user.display_name AS userName,
          user.username,
          member.status,
          member.updated_at AS updatedAt
        FROM customer_workflow_members member
        JOIN users user
          ON user.id = member.user_id
         AND user.deleted_at IS NULL
        LEFT JOIN customers customer
          ON customer.customer_code = member.customer_code
         AND customer.deleted_at IS NULL
        WHERE member.deleted_at IS NULL
          AND member.status = 'active'
        ORDER BY customer.customer_name, member.role_code, user.display_name
      `),
        this.dataSource.query(`
        SELECT
          member.id,
          member.business_category_code AS businessCategoryCode,
          member.user_id AS userId,
          user.display_name AS userName,
          user.username,
          member.status,
          member.updated_at AS updatedAt
        FROM business_category_review_members member
        JOIN users user
          ON user.id = member.user_id
         AND user.deleted_at IS NULL
        WHERE member.deleted_at IS NULL
          AND member.status = 'active'
        ORDER BY FIELD(member.business_category_code, 'design', 'copywriting', 'operation', 'community'), user.display_name
      `),
        this.dataSource.query(`
        SELECT
          member.id,
          member.role_code AS roleCode,
          member.user_id AS userId,
          user.display_name AS userName,
          user.username,
          member.status,
          member.updated_at AS updatedAt
        FROM global_workflow_members member
        JOIN users user
          ON user.id = member.user_id
         AND user.deleted_at IS NULL
        WHERE member.deleted_at IS NULL
          AND member.status = 'active'
        ORDER BY member.role_code, user.display_name
      `),
      ]);

    return {
      customerMembers,
      businessCategoryReviewers,
      globalMembers,
      businessCategories: businessCategories.map((item) => ({ ...item })),
    };
  }

  async getConfiguration() {
    return this.findAll();
  }

  async replaceCustomerDispatchers(customerCode: string, userIds: string[]) {
    return this.replaceCustomerMembers(customerCode, 'dispatcher', userIds);
  }

  async replaceProductReviewers(categoryCode: string, userIds: string[]) {
    return this.replaceBusinessCategoryReviewers(categoryCode, userIds);
  }

  async replaceCustomerReviewers(customerCode: string, userIds: string[]) {
    return this.replaceCustomerMembers(
      customerCode,
      'customer_reviewer',
      userIds,
    );
  }

  async replaceReportRecipients(userIds: string[]) {
    return this.replaceGlobalMembers('report_recipient', userIds);
  }

  async replaceGlobalMembers(roleCode: string, userIds: string[]) {
    const normalizedRole = String(roleCode ?? '').trim();
    if (normalizedRole !== 'report_recipient') {
      throw new BadRequestException('无效的全局流程角色');
    }
    const normalizedUserIds = await this.validateActiveUserIds(userIds);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE global_workflow_members
         SET status = 'inactive', deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE role_code = ?`,
        [normalizedRole],
      );
      for (const userId of normalizedUserIds) {
        await manager.query(
          `INSERT INTO global_workflow_members (id, role_code, user_id, status)
           VALUES (?, ?, ?, 'active')
           ON DUPLICATE KEY UPDATE status = 'active', deleted_at = NULL, updated_at = CURRENT_TIMESTAMP`,
          [randomUUID(), normalizedRole, userId],
        );
      }
    });
    return this.findAll();
  }

  async findGlobalMemberIds(roleCode: string): Promise<string[]> {
    const rows: Array<{ userId: string }> = await this.dataSource.query(
      `SELECT member.user_id AS userId
       FROM global_workflow_members member
       JOIN users user ON user.id = member.user_id
        AND user.status = 'active' AND user.deleted_at IS NULL
       WHERE member.role_code = ? AND member.status = 'active' AND member.deleted_at IS NULL
       ORDER BY member.created_at, member.user_id`,
      [roleCode],
    );
    return [...new Set(rows.map((row) => row.userId).filter(Boolean))];
  }

  private async seedDefaultReportRecipients() {
    const existing: Array<{ total: number }> = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM global_workflow_members WHERE role_code = 'report_recipient'`,
    );
    if (Number(existing[0]?.total ?? 0) > 0) return;
    const admins: Array<{ userId: string }> = await this.dataSource.query(
      `SELECT DISTINCT user_role.user_id AS userId
       FROM user_roles user_role
       JOIN roles role ON role.id = user_role.role_id AND role.role_code = 'admin'
       JOIN users user ON user.id = user_role.user_id AND user.status = 'active' AND user.deleted_at IS NULL`,
    );
    for (const admin of admins) {
      await this.dataSource.query(
        `INSERT IGNORE INTO global_workflow_members (id, role_code, user_id, status) VALUES (?, 'report_recipient', ?, 'active')`,
        [randomUUID(), admin.userId],
      );
    }
  }

  async replaceCustomerMembers(
    customerCode: string,
    roleCode: string,
    userIds: string[],
  ) {
    const normalizedCustomerCode = String(customerCode ?? '').trim();
    const normalizedRole = this.normalizeCustomerRole(roleCode);
    if (!normalizedCustomerCode) {
      throw new BadRequestException('基金不能为空');
    }
    await this.assertCustomerExists(normalizedCustomerCode);
    const normalizedUserIds = await this.validateActiveUserIds(userIds);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
          UPDATE customer_workflow_members
          SET status = 'inactive',
              deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE customer_code = ?
            AND role_code = ?
        `,
        [normalizedCustomerCode, normalizedRole],
      );
      for (const userId of normalizedUserIds) {
        await manager.query(
          `
            INSERT INTO customer_workflow_members (
              id, customer_code, role_code, user_id, status
            ) VALUES (?, ?, ?, ?, 'active')
            ON DUPLICATE KEY UPDATE
              status = 'active',
              deleted_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          `,
          [randomUUID(), normalizedCustomerCode, normalizedRole, userId],
        );
      }
    });

    return this.findAll();
  }

  async replaceBusinessCategoryReviewers(
    categoryCode: string,
    userIds: string[],
  ) {
    const normalizedCategoryCode = this.normalizeBusinessCategory(categoryCode);
    const normalizedUserIds = await this.validateActiveUserIds(userIds);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
          UPDATE business_category_review_members
          SET status = 'inactive',
              deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE business_category_code = ?
        `,
        [normalizedCategoryCode],
      );
      for (const userId of normalizedUserIds) {
        await manager.query(
          `
            INSERT INTO business_category_review_members (
              id, business_category_code, user_id, status
            ) VALUES (?, ?, ?, 'active')
            ON DUPLICATE KEY UPDATE
              status = 'active',
              deleted_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          `,
          [randomUUID(), normalizedCategoryCode, userId],
        );
      }
    });

    return this.findAll();
  }

  async findCustomerMemberIds(
    customerCode: string | null | undefined,
    roleCode: CustomerWorkflowRole,
  ): Promise<string[]> {
    const normalizedCustomerCode = String(customerCode ?? '').trim();
    if (!normalizedCustomerCode) return [];
    const rows: Array<{ userId: string }> = await this.dataSource.query(
      `
        SELECT member.user_id AS userId
        FROM customer_workflow_members member
        JOIN users user
          ON user.id = member.user_id
         AND user.status = 'active'
         AND user.deleted_at IS NULL
        WHERE member.customer_code = ?
          AND member.role_code = ?
          AND member.status = 'active'
          AND member.deleted_at IS NULL
        ORDER BY member.created_at, member.user_id
      `,
      [normalizedCustomerCode, roleCode],
    );
    return [...new Set(rows.map((row) => row.userId).filter(Boolean))];
  }

  async findBusinessCategoryReviewerIds(
    categoryCode: string | null | undefined,
  ): Promise<string[]> {
    const normalizedCategoryCode =
      this.tryNormalizeBusinessCategory(categoryCode);
    if (!normalizedCategoryCode) return [];
    const rows: Array<{ userId: string }> = await this.dataSource.query(
      `
        SELECT member.user_id AS userId
        FROM business_category_review_members member
        JOIN users user
          ON user.id = member.user_id
         AND user.status = 'active'
         AND user.deleted_at IS NULL
        WHERE member.business_category_code = ?
          AND member.status = 'active'
          AND member.deleted_at IS NULL
        ORDER BY member.created_at, member.user_id
      `,
      [normalizedCategoryCode],
    );
    return [...new Set(rows.map((row) => row.userId).filter(Boolean))];
  }

  normalizeBusinessCategory(value: string | null | undefined) {
    const normalized = this.tryNormalizeBusinessCategory(value);
    if (!normalized) {
      throw new BadRequestException('无效的业务大类');
    }
    return normalized;
  }

  private tryNormalizeBusinessCategory(value: string | null | undefined) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    if (!normalized) return null;
    const match = businessCategories.find(
      (item) => item.code === normalized || item.name === String(value).trim(),
    );
    return match?.code ?? null;
  }

  private normalizeCustomerRole(value: string): CustomerWorkflowRole {
    if ((CUSTOMER_WORKFLOW_ROLES as readonly string[]).includes(value)) {
      return value as CustomerWorkflowRole;
    }
    throw new BadRequestException('无效的基金流程角色');
  }

  private async assertCustomerExists(customerCode: string) {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `
        SELECT id
        FROM customers
        WHERE customer_code = ?
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [customerCode],
    );
    if (!rows.length) {
      throw new NotFoundException('基金不存在或已停用');
    }
  }

  private async validateActiveUserIds(userIds: string[]) {
    const normalized = [
      ...new Set(
        (Array.isArray(userIds) ? userIds : [])
          .map((userId) => String(userId ?? '').trim())
          .filter(Boolean),
      ),
    ];
    if (!normalized.length) return [];
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `
        SELECT id
        FROM users
        WHERE id IN (${normalized.map(() => '?').join(',')})
          AND status = 'active'
          AND deleted_at IS NULL
      `,
      normalized,
    );
    const activeIds = new Set(rows.map((row) => row.id));
    const invalidIds = normalized.filter((userId) => !activeIds.has(userId));
    if (invalidIds.length) {
      throw new BadRequestException('选择的员工不存在或已停用');
    }
    return normalized;
  }

  private async migrateLegacyMappings() {
    if (await this.tableExists('product_review_team_members')) {
      await this.dataSource.query(`
        INSERT IGNORE INTO business_category_review_members (
          id, business_category_code, user_id, status, created_at, updated_at, deleted_at
        )
        SELECT
          UUID(), review_type, user_id, status, created_at, updated_at, deleted_at
        FROM product_review_team_members
        WHERE user_id IS NOT NULL
          AND user_id <> ''
      `);
    }
  }

  private async tableExists(tableName: string, manager?: EntityManager) {
    const executor = manager ?? this.dataSource;
    const rows: Array<{ count: string | number }> = await executor.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = ?
      `,
      [tableName],
    );
    return Number(rows?.[0]?.count ?? 0) > 0;
  }
}
