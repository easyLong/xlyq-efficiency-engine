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
    priority: 'medium',
    assignee_user_id: 'user-1',
    reporter_user_id: null,
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
      {} as never,
    );

    return {
      service,
      taskRepositoryInTx,
      taskStatusHistoriesRepository,
      fileRepositoryInTx,
      usersRepository,
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
      savedFiles,
    } = buildService();

    const result = await service.saveLocalAssetSheet(
      task.id,
      {
        imageUrls: ['http://example.com/asset.png'],
        linkUrl: 'http://example.com/delivery',
      },
      tokenForTask(),
    );

    expect(fileRepositoryInTx.softDelete).toHaveBeenCalled();
    expect(savedFiles).toHaveLength(2);
    expect(taskRepositoryInTx.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.PendingReview,
        progress_percent: 90,
      }),
    );
    expect(result.task.status).toBe(TaskStatus.PendingReview);
    expect(result.assetCount).toBe(1);
    expect(result.syncedCount).toBe(2);
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
});
