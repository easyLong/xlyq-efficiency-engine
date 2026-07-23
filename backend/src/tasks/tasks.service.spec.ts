import { createHmac } from 'node:crypto';
import { TasksService } from './tasks.service';
import { TaskStatus } from './task-status';

describe('TasksService delivery flow', () => {
  const task = {
    id: 'task-1',
    project_id: 'project-1',
    requirement_item_id: null,
    task_no: 'TASK-0001',
    task_name: '测试任务',
    description: null,
    status: TaskStatus.Assigned,
    review_stage: 'none',
    priority: 'medium',
    assignee_user_id: 'user-1',
    reporter_user_id: null,
    dispatcher_user_id: null,
    product_review_type: null,
    product_reviewer_user_id: null,
    customer_reviewer_user_id: null,
    estimated_hours: null,
    actual_hours: '0',
    progress_percent: 0,
    blocked_reason: null,
    planned_end_at: null,
    actual_end_at: null,
  };

  function buildService() {
    const savedFiles: unknown[] = [];
    const tasksRepository = {
      findOne: jest.fn().mockResolvedValue({ ...task }),
      save: jest.fn(async (value) => value),
    };
    const taskRepositoryInTx = {
      findOne: jest.fn().mockResolvedValue({ ...task }),
      save: jest.fn(async (value) => value),
    };
    const fileRepositoryInTx = {
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        savedFiles.push(value);
        return value;
      }),
    };
    const taskStatusHistoriesRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const usersRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-1',
        username: 'member.user',
        display_name: '执行人',
        email: null,
        mobile: null,
        avatar_url: null,
        status: 'active',
        source: 'local',
        feishu_open_id: null,
      }),
    };
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('requirement.business_category AS businessCategory')) {
          return [
            {
              businessCategory: '设计',
              customerCode: 'Wanjia',
              customerName: '万家基金',
              businessPlatform: '招行',
            },
          ];
        }
        if (sql.includes('FROM product_review_team_members')) {
          return [{ userId: 'reviewer-1' }];
        }
        if (sql.includes('INSERT INTO task_review_records')) {
          return [];
        }
        return [];
      }),
      transaction: jest.fn((callback) =>
        callback({
          getRepository: (entity: { name: string }) => {
            if (entity.name === 'TaskResultFileEntity') {
              return fileRepositoryInTx;
            }
            if (entity.name === 'TaskEntity') {
              return taskRepositoryInTx;
            }
            throw new Error(`Unexpected repository ${entity.name}`);
          },
        }),
      ),
    };
    const notificationsService = {
      notifyTaskAssetsSubmittedForReview: jest.fn().mockResolvedValue({
        id: 'notification-1',
      }),
      notifyTaskAssetsSubmittedForProductReview: jest
        .fn()
        .mockResolvedValue([{ id: 'notification-1' }]),
    };
    const workflowConfigsService = {
      findBusinessCategoryReviewerIds: jest
        .fn()
        .mockResolvedValue(['reviewer-1']),
      findCustomerMemberIds: jest.fn().mockResolvedValue(['reviewer-2']),
    };
    const noopRepository = {};
    const service = new TasksService(
      tasksRepository as never,
      noopRepository as never,
      noopRepository as never,
      noopRepository as never,
      noopRepository as never,
      taskStatusHistoriesRepository as never,
      noopRepository as never,
      noopRepository as never,
      usersRepository as never,
      dataSource as never,
      {} as never,
      notificationsService as never,
      workflowConfigsService as never,
    );

    return {
      service,
      tasksRepository,
      dataSource,
      taskRepositoryInTx,
      taskStatusHistoriesRepository,
      fileRepositoryInTx,
      usersRepository,
      notificationsService,
      savedFiles,
    };
  }

  function tokenForTask() {
    return createHmac('sha256', 'test-secret')
      .update(`${task.id}:${task.task_no}`)
      .digest('hex');
  }

  beforeEach(() => {
    process.env.TASK_ACCESS_TOKEN_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.TASK_ACCESS_TOKEN_SECRET;
  });

  it('moves a submitted local asset sheet into pending review', async () => {
    const {
      service,
      taskRepositoryInTx,
      taskStatusHistoriesRepository,
      fileRepositoryInTx,
      notificationsService,
      savedFiles,
    } = buildService();

    const result = await service.saveLocalAssetSheet(
      task.id,
      {
        imageUrls: ['http://example.com/asset.png'],
        linkUrls: [
          'http://example.com/delivery',
          'http://example.com/source-file',
        ],
      },
      tokenForTask(),
    );

    expect(fileRepositoryInTx.softDelete).toHaveBeenCalled();
    expect(savedFiles).toHaveLength(3);
    expect(taskRepositoryInTx.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.PendingReview,
        review_stage: 'product_review',
        product_review_type: 'design',
        progress_percent: 90,
      }),
    );
    expect(result.task.status).toBe(TaskStatus.PendingReview);
    expect(result.task.review_stage).toBe('product_review');
    expect(result.assetCount).toBe(1);
    expect(result.syncedCount).toBe(3);
    expect(savedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file_name: '合作链接-1',
          file_url: 'http://example.com/delivery',
          source: 'local_asset_sheet_link',
        }),
        expect.objectContaining({
          file_name: '合作链接-2',
          file_url: 'http://example.com/source-file',
          source: 'local_asset_sheet_link',
        }),
      ]),
    );
    expect(
      notificationsService.notifyTaskAssetsSubmittedForProductReview,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ status: TaskStatus.PendingReview }),
      1,
      ['reviewer-1'],
    );
    expect(result.assigneeSession).toEqual(
      expect.objectContaining({
        accessToken: 'mvp-user-1',
        user: expect.objectContaining({
          id: 'user-1',
          username: 'member.user',
          permissions: expect.arrayContaining(['task.view_assigned']),
        }),
      }),
    );
    expect(taskStatusHistoriesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        from_status: TaskStatus.Assigned,
        to_status: TaskStatus.PendingReview,
        trigger_source: 'local_asset_submitted',
      }),
    );
  });

  it('rejects an empty delivery submission', async () => {
    const { service } = buildService();

    await expect(
      service.saveLocalAssetSheet(task.id, {}, tokenForTask()),
    ).rejects.toThrow('请至少上传一张图片或填写一个交付链接后再提交交付');
  });

  it('locks delivery while the task is under review', async () => {
    const { service, tasksRepository } = buildService();
    tasksRepository.findOne.mockResolvedValue({
      ...task,
      status: TaskStatus.PendingReview,
      review_stage: 'product_review',
    });

    await expect(
      service.saveLocalAssetSheet(
        task.id,
        { imageUrls: ['http://example.com/asset.png'] },
        tokenForTask(),
      ),
    ).rejects.toThrow('任务正在审核中');
  });

  it('rejects a product review after another reviewer wins the stage', async () => {
    const { service, dataSource } = buildService();
    const pendingReviewTask = {
      ...task,
      status: TaskStatus.PendingReview,
      review_stage: 'product_review',
      product_review_type: 'design',
    };

    await expect(
      (
        service as unknown as {
          approveProductReview: (
            value: typeof pendingReviewTask,
            reviewerUserId: string,
          ) => Promise<unknown>;
        }
      ).approveProductReview(pendingReviewTask, 'reviewer-1'),
    ).rejects.toThrow('该任务已由其他一审人员处理');

    const transitionCall = dataSource.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE tasks'),
    );
    expect(transitionCall?.[0]).toContain('AND review_stage = ?');
    expect(transitionCall?.[1]).toEqual([
      'customer_review',
      'reviewer-1',
      task.id,
      TaskStatus.PendingReview,
      'product_review',
    ]);
  });
});
