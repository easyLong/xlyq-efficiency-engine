import { AccessProfile } from '../common/access-control';
import { UserEntity } from '../users/entities/user.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskStatus } from './task-status';
import {
  buildTaskWorkflowView,
  TaskWorkflowRuntimeService,
} from './task-workflow-runtime.service';

describe('task role workflow view', () => {
  const baseTask = {
    id: 'task-1',
    status: TaskStatus.PendingReview,
    review_stage: 'product_review',
    current_step: 'first_review',
    delivery_version: 1,
    returned_from_step: null,
    dispatcher_user_id: 'dispatcher-1',
    assignee_user_id: 'executor-1',
    reporter_user_id: null,
    product_reviewer_user_id: null,
    customer_reviewer_user_id: null,
    created_by_user_id: null,
    planned_end_at: null,
  } as unknown as TaskEntity;

  const memberProfile = {
    roleCodes: [],
    effectiveRoles: ['member'],
    permissions: ['task.view_assigned'],
    dataScope: {
      requirements: 'assigned',
      tasks: 'assigned',
      quotes: 'none',
      settlement: 'none',
    },
    ownedBusinessCategoryCodes: [],
    dispatchCustomerCodes: [],
    productReviewTypes: ['design'],
    customerReviewCodes: [],
    isAdmin: false,
  } as AccessProfile;

  const reviewer = {
    id: 'reviewer-1',
    username: 'reviewer',
  } as UserEntity;

  it('shows an open first review as the reviewer personal todo', () => {
    const view = buildTaskWorkflowView(
      baseTask,
      [
        {
          id: 'work-1',
          taskId: baseTask.id,
          stepType: 'first_review',
          deliveryVersion: 1,
          status: 'open',
          claimedByUserId: null,
          actorName: null,
          result: null,
          remark: null,
          openedAt: new Date(),
          closedAt: null,
          candidates: [
            { userId: reviewer.id, userName: '一审人员', status: 'open' },
          ],
        },
      ] as never,
      reviewer,
      memberProfile,
      { businessCategory: '设计', customerCode: 'Wanjia' },
    );

    expect(view.primaryMyState).toEqual(
      expect.objectContaining({
        roleCode: 'first_reviewer',
        statusLabel: '待我一审',
        actionable: true,
      }),
    );
    expect(view.roleStates).toBeUndefined();
  });

  it('distinguishes a second-review return for the executor', () => {
    const returnedTask = {
      ...baseTask,
      status: TaskStatus.Returned,
      review_stage: 'none',
      current_step: 'execute',
      returned_from_step: 'second_review',
    } as TaskEntity;
    const executor = {
      id: 'executor-1',
      username: 'executor',
    } as UserEntity;
    const view = buildTaskWorkflowView(
      returnedTask,
      [] as never,
      executor,
      memberProfile,
      { businessCategory: '设计', customerCode: 'Wanjia' },
    );

    expect(view.global.statusLabel).toBe('二审退回·待修改');
    expect(view.primaryMyState).toEqual(
      expect.objectContaining({
        roleCode: 'executor',
        statusLabel: '待修改·二审退回',
      }),
    );
  });

  it('returns every role state to an administrator', () => {
    const adminProfile = {
      ...memberProfile,
      effectiveRoles: ['admin'],
      permissions: ['*'],
      dataScope: {
        requirements: 'all',
        tasks: 'all',
        quotes: 'all',
        settlement: 'all',
      },
      isAdmin: true,
    } as AccessProfile;
    const admin = { id: 'admin-1', username: 'admin' } as UserEntity;
    const view = buildTaskWorkflowView(
      baseTask,
      [] as never,
      admin,
      adminProfile,
      { businessCategory: '设计', customerCode: 'Wanjia' },
    );

    expect(view.roleStates?.map((state) => state.roleCode)).toEqual([
      'dispatcher',
      'executor',
      'first_reviewer',
      'second_reviewer',
    ]);
  });

  it('prioritizes an actionable review when one user has multiple roles', () => {
    const multiRoleProfile = {
      ...memberProfile,
      effectiveRoles: ['product_reviewer'],
    } as AccessProfile;
    const multiRoleUser = {
      ...reviewer,
      id: 'multi-role-user',
    } as UserEntity;
    const multiRoleTask = { ...baseTask } as TaskEntity;
    const view = buildTaskWorkflowView(
      multiRoleTask,
      [
        {
          id: 'work-2',
          taskId: multiRoleTask.id,
          stepType: 'first_review',
          deliveryVersion: 1,
          status: 'open',
          claimedByUserId: null,
          actorName: null,
          result: null,
          remark: null,
          openedAt: new Date(),
          closedAt: null,
          candidates: [
            {
              userId: multiRoleUser.id,
              userName: '多角色人员',
              status: 'open',
            },
          ],
        },
      ] as never,
      multiRoleUser,
      multiRoleProfile,
      { businessCategory: '设计', customerCode: 'Wanjia' },
    );

    expect(view.myStates.map((state) => state.roleCode)).toEqual([
      'first_reviewer',
    ]);
    expect(view.primaryMyState).toEqual(
      expect.objectContaining({
        roleCode: 'first_reviewer',
        statusLabel: '待我一审',
      }),
    );
  });

  it('shows that another reviewer already claimed the shared work item', () => {
    const view = buildTaskWorkflowView(
      baseTask,
      [
        {
          id: 'work-claimed',
          taskId: baseTask.id,
          stepType: 'first_review',
          deliveryVersion: 1,
          status: 'claimed',
          claimedByUserId: 'reviewer-2',
          actorName: '另一位审核人',
          result: null,
          remark: null,
          openedAt: new Date(),
          claimedAt: new Date(),
          closedAt: null,
          candidates: [
            {
              userId: reviewer.id,
              userName: '一审人员',
              status: 'claimed_by_other',
            },
          ],
        },
      ] as never,
      reviewer,
      memberProfile,
      { businessCategory: '设计', customerCode: 'Wanjia' },
    );

    expect(view.primaryMyState).toEqual(
      expect.objectContaining({
        roleCode: 'first_reviewer',
        statusKey: 'claimed_by_other',
        statusLabel: '已由另一位审核人领取',
        actionable: false,
      }),
    );
  });

  it('marks missing legacy first-review history without showing it as unstarted', () => {
    const adminProfile = {
      ...memberProfile,
      effectiveRoles: ['admin'],
      permissions: ['*'],
      dataScope: {
        requirements: 'all',
        tasks: 'all',
        quotes: 'all',
        settlement: 'all',
      },
      isAdmin: true,
    } as AccessProfile;
    const admin = { id: 'admin-1', username: 'admin' } as UserEntity;
    const legacySecondReviewTask = {
      ...baseTask,
      review_stage: 'customer_review',
      current_step: 'second_review',
      product_reviewer_user_id: null,
    } as TaskEntity;
    const view = buildTaskWorkflowView(
      legacySecondReviewTask,
      [] as never,
      admin,
      adminProfile,
      { businessCategory: '设计', customerCode: 'Wanjia' },
    );

    expect(
      view.roleStates?.find((state) => state.roleCode === 'first_reviewer'),
    ).toEqual(
      expect.objectContaining({
        statusLabel: '历史一审已通过·人员未知',
        bucket: 'done',
      }),
    );
  });
});

describe('task work item claiming', () => {
  it('claims an open item and marks the other candidates as unavailable', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          workItemId: 'work-1',
          status: 'open',
          claimedByUserId: null,
          claimedByName: null,
          claimedAt: null,
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 2 })
      .mockResolvedValueOnce([
        {
          workItemId: 'work-1',
          status: 'claimed',
          claimedByUserId: 'reviewer-1',
          claimedByName: '审核人一',
          claimedAt: new Date(),
        },
      ]);
    const runtime = new TaskWorkflowRuntimeService({ query } as never);

    const claim = await runtime.claimStep(
      'task-1',
      'first_review' as never,
      'reviewer-1',
    );

    expect(claim).toEqual(
      expect.objectContaining({
        workItemId: 'work-1',
        claimedByUserId: 'reviewer-1',
      }),
    );
    expect(query.mock.calls[1][0]).toContain("AND status = 'open'");
    expect(query.mock.calls[3][0]).toContain("THEN 'claimed_by_other'");
  });

  it('rejects a second claimant with the current claimant name', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        workItemId: 'work-1',
        status: 'claimed',
        claimedByUserId: 'reviewer-2',
        claimedByName: '审核人二',
        claimedAt: new Date(),
      },
    ]);
    const runtime = new TaskWorkflowRuntimeService({ query } as never);

    await expect(
      runtime.claimStep('task-1', 'first_review' as never, 'reviewer-1'),
    ).rejects.toThrow('该工作项已由审核人二领取');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
