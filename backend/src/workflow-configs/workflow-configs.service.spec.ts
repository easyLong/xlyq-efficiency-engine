import { WorkflowConfigsService } from './workflow-configs.service';

describe('WorkflowConfigsService', () => {
  function createFixture() {
    const manager = {
      query: jest.fn().mockResolvedValue({ affectedRows: 1 }),
    };
    const dataSource = {
      query: jest.fn(async (sql: string, parameters?: string[]) => {
        if (sql.includes('SELECT id') && sql.includes('FROM customers')) {
          return [{ id: 'customer-1' }];
        }
        if (sql.includes('SELECT id') && sql.includes('FROM users')) {
          return (parameters ?? []).map((id) => ({ id }));
        }
        if (sql.includes('FROM customer_workflow_members member')) {
          return [];
        }
        if (sql.includes('FROM business_category_review_members member')) {
          return [];
        }
        return { affectedRows: 1 };
      }),
      transaction: jest.fn(
        async (callback: (entityManager: typeof manager) => unknown) =>
          callback(manager),
      ),
    };
    return {
      dataSource,
      manager,
      service: new WorkflowConfigsService(dataSource as never),
    };
  }

  it('replaces a fund dispatcher team with unique active users', async () => {
    const { service, manager } = createFixture();

    await service.replaceCustomerMembers('Wanjia', 'dispatcher', [
      'user-1',
      'user-2',
      'user-1',
    ]);

    expect(manager.query).toHaveBeenCalledTimes(3);
    expect(manager.query.mock.calls[0][0]).toContain(
      'UPDATE customer_workflow_members',
    );
    expect(manager.query.mock.calls[1][1]).toEqual([
      expect.any(String),
      'Wanjia',
      'dispatcher',
      'user-1',
    ]);
    expect(manager.query.mock.calls[2][1]).toEqual([
      expect.any(String),
      'Wanjia',
      'dispatcher',
      'user-2',
    ]);
  });

  it('syncs the primary fund reviewer to unfinished tasks', async () => {
    const { service, dataSource } = createFixture();

    await service.replaceCustomerMembers('Bosera', 'customer_reviewer', [
      'reviewer-1',
      'reviewer-2',
    ]);

    const syncCall = dataSource.query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE tasks task'),
    );
    expect(syncCall?.[1]).toEqual(['reviewer-1', 'Bosera']);
  });
});
