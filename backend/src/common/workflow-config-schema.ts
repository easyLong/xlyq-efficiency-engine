import { DataSource } from 'typeorm';

export const WORKFLOW_REVIEW_TYPES = [
  'design',
  'copywriting',
  'operation',
  'community',
] as const;

export type WorkflowReviewType = (typeof WORKFLOW_REVIEW_TYPES)[number];

export async function ensureWorkflowConfigTables(dataSource: DataSource) {
  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS customer_workflow_members (
      id CHAR(36) NOT NULL,
      customer_code VARCHAR(64) NOT NULL,
      role_code VARCHAR(32) NOT NULL,
      user_id CHAR(36) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_customer_workflow_member (customer_code, role_code, user_id),
      KEY idx_customer_workflow_user_role (user_id, role_code),
      KEY idx_customer_workflow_role_customer (role_code, customer_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await upgradeCustomerWorkflowMembers(dataSource);

  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS business_category_review_members (
      id CHAR(36) NOT NULL,
      business_category_code VARCHAR(64) NOT NULL,
      user_id CHAR(36) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_business_category_review_member (business_category_code, user_id),
      KEY idx_business_category_review_user (user_id),
      KEY idx_business_category_review_category (business_category_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await upgradeBusinessCategoryReviewMembers(dataSource);
}

async function upgradeCustomerWorkflowMembers(dataSource: DataSource) {
  const hasRoleCode = await columnExists(
    dataSource,
    'customer_workflow_members',
    'role_code',
  );
  const hasLegacyRoleType = await columnExists(
    dataSource,
    'customer_workflow_members',
    'role_type',
  );

  if (!hasRoleCode && hasLegacyRoleType) {
    await dataSource.query(`
      ALTER TABLE customer_workflow_members
      CHANGE COLUMN role_type role_code VARCHAR(32) NOT NULL
    `);
  } else if (!hasRoleCode) {
    await dataSource.query(`
      ALTER TABLE customer_workflow_members
      ADD COLUMN role_code VARCHAR(32) NOT NULL DEFAULT 'dispatcher' AFTER customer_code
    `);
  }

  if (
    !(await columnExists(
      dataSource,
      'customer_workflow_members',
      'deleted_at',
    ))
  ) {
    await dataSource.query(`
      ALTER TABLE customer_workflow_members
      ADD COLUMN deleted_at DATETIME NULL AFTER updated_at
    `);
  }

  await dataSource.query(`
    ALTER TABLE customer_workflow_members
    MODIFY COLUMN customer_code VARCHAR(64) NOT NULL,
    MODIFY COLUMN role_code VARCHAR(32) NOT NULL,
    MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'
  `);

  if (
    !(await uniqueIndexExists(dataSource, 'customer_workflow_members', [
      'customer_code',
      'role_code',
      'user_id',
    ]))
  ) {
    await dataSource.query(`
      ALTER TABLE customer_workflow_members
      ADD UNIQUE KEY uk_customer_workflow_member (customer_code, role_code, user_id)
    `);
  }
}

async function upgradeBusinessCategoryReviewMembers(dataSource: DataSource) {
  if (
    !(await columnExists(
      dataSource,
      'business_category_review_members',
      'deleted_at',
    ))
  ) {
    await dataSource.query(`
      ALTER TABLE business_category_review_members
      ADD COLUMN deleted_at DATETIME NULL AFTER updated_at
    `);
  }

  if (
    !(await uniqueIndexExists(dataSource, 'business_category_review_members', [
      'business_category_code',
      'user_id',
    ]))
  ) {
    await dataSource.query(`
      ALTER TABLE business_category_review_members
      ADD UNIQUE KEY uk_business_category_review_member (business_category_code, user_id)
    `);
  }
}

async function columnExists(
  dataSource: DataSource,
  tableName: string,
  columnName: string,
) {
  const rows: Array<{ present: number }> = await dataSource.query(
    `
      SELECT 1 AS present
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [tableName, columnName],
  );
  return rows.length > 0;
}

async function uniqueIndexExists(
  dataSource: DataSource,
  tableName: string,
  columnNames: string[],
) {
  const rows: Array<{ columnsList: string }> = await dataSource.query(
    `
      SELECT GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columnsList
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND non_unique = 0
      GROUP BY index_name
    `,
    [tableName],
  );
  const expectedColumns = [...columnNames].sort().join(',');
  return rows.some(
    (row) => row.columnsList.split(',').sort().join(',') === expectedColumns,
  );
}
