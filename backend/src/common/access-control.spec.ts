import { buildAccessProfile } from './access-control';

describe('workflow access profile', () => {
  it('combines fund dispatcher, category reviewer and fund reviewer scopes', async () => {
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM user_roles')) return [];
        if (sql.includes('FROM business_category_owner_configs')) return [];
        if (
          sql.includes('FROM customer_workflow_members') &&
          sql.includes("role_code = 'dispatcher'")
        ) {
          return [{ customer_code: 'Wanjia' }];
        }
        if (
          sql.includes('FROM customer_workflow_members') &&
          sql.includes("role_code = 'customer_reviewer'")
        ) {
          return [{ customer_code: 'Bosera' }];
        }
        if (sql.includes('FROM business_category_review_members')) {
          return [{ review_type: 'design' }];
        }
        return [];
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
        'customer_owner',
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
