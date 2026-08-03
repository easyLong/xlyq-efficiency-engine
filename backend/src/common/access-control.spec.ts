import { buildAccessProfile } from './access-control';

describe('workflow access profile', () => {
  it('does not grant an effective role from the retired owner mapping', async () => {
    const dataSource = {
      query: jest.fn((sql: string) => {
        if (sql.includes('FROM user_roles')) {
          return Promise.resolve([{ role_code: 'owner' }]);
        }
        if (sql.includes('FROM business_category_owner_configs')) {
          return Promise.resolve([{ business_category_code: 'design' }]);
        }
        return Promise.resolve([]);
      }),
    };

    const profile = await buildAccessProfile(dataSource as never, {
      id: 'owner-1',
      username: 'legacy.owner',
    });

    expect(profile.effectiveRoles).toEqual(['member']);
    expect(profile.permissions).not.toContain('requirement.view_owned');
    expect(profile.permissions).not.toContain('requirement.create');
    expect(profile.permissions).not.toContain('ai_preview.view_owned');
    expect(profile.permissions).not.toContain('ai_preview.confirm_owned');
    expect(
      dataSource.query.mock.calls.some(([sql]) =>
        String(sql).includes('business_category_owner_configs'),
      ),
    ).toBe(false);
  });

  it('combines fund dispatcher, category reviewer and fund reviewer scopes', async () => {
    const dataSource = {
      query: jest.fn((sql: string) => {
        if (sql.includes('FROM user_roles')) return Promise.resolve([]);
        if (sql.includes('FROM business_category_owner_configs')) {
          return Promise.resolve([]);
        }
        if (
          sql.includes('FROM customer_workflow_members') &&
          sql.includes("role_code = 'dispatcher'")
        ) {
          return Promise.resolve([{ customer_code: 'Wanjia' }]);
        }
        if (
          sql.includes('FROM customer_workflow_members') &&
          sql.includes("role_code = 'customer_reviewer'")
        ) {
          return Promise.resolve([{ customer_code: 'Bosera' }]);
        }
        if (sql.includes('FROM business_category_review_members')) {
          return Promise.resolve([{ review_type: 'design' }]);
        }
        return Promise.resolve([]);
      }),
    };

    const profile = await buildAccessProfile(dataSource as never, {
      id: 'user-1',
      username: 'workflow.user',
    });

    expect(profile.effectiveRoles).toEqual(
      expect.arrayContaining([
        'dispatcher',
        'product_reviewer',
        'second_reviewer',
      ]),
    );
    expect(profile.dispatchCustomerCodes).toEqual(['Wanjia']);
    expect(profile.productReviewTypes).toEqual(['design']);
    expect(profile.customerReviewCodes).toEqual(['Bosera']);
    expect(profile.permissions).toEqual(
      expect.arrayContaining([
        'requirement.create',
        'task.assign_owned',
        'task.accept_owned',
      ]),
    );
  });
});
