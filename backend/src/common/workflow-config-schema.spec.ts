import { DataSource } from 'typeorm';
import { ensureWorkflowConfigTables } from './workflow-config-schema';

describe('ensureWorkflowConfigTables', () => {
  it('upgrades the legacy customer role_type column without losing rows', async () => {
    const query = jest.fn(
      async (sql: string, parameters?: [string, string] | [string]) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.includes('FROM information_schema.columns')) {
          const [tableName, columnName] = parameters as [string, string];
          const existingColumns = new Set([
            'customer_workflow_members:role_type',
            'business_category_review_members:deleted_at',
          ]);
          return existingColumns.has(`${tableName}:${columnName}`)
            ? [{ present: 1 }]
            : [];
        }
        if (normalizedSql.includes('FROM information_schema.statistics')) {
          const [tableName] = parameters as [string];
          return tableName === 'customer_workflow_members'
            ? [{ columnsList: 'customer_code,user_id,role_code' }]
            : [{ columnsList: 'business_category_code,user_id' }];
        }
        return { affectedRows: 1 };
      },
    );

    await ensureWorkflowConfigTables({ query } as unknown as DataSource);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'CHANGE COLUMN role_type role_code VARCHAR(32) NOT NULL',
      ),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN deleted_at DATETIME NULL'),
    );
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('ADD UNIQUE KEY uk_customer_workflow_member'),
      ),
    ).toBe(false);
  });
});
