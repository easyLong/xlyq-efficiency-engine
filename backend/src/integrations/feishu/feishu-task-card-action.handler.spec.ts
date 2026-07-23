import { createHmac } from 'node:crypto';
import { FeishuTaskCardActionHandler } from './feishu-task-card-action.handler';

describe('FeishuTaskCardActionHandler', () => {
  it('does not let a legacy progress card complete a task', async () => {
    const task = {
      id: 'task-1',
      task_no: 'TASK-0001',
      task_name: '测试任务',
      status: 'in_progress',
      progress_percent: 30,
      actual_end_at: null,
    };
    const token = createHmac('sha256', 'test-secret')
      .update(`${task.id}:${task.task_no}`)
      .digest('hex');
    const repository = {
      findOne: jest.fn().mockResolvedValue(task),
      save: jest.fn(),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'TASK_ACCESS_TOKEN_SECRET') return 'test-secret';
        if (key === 'APP_PUBLIC_BASE_URL') return 'http://192.168.10.5:3000';
        return undefined;
      }),
    };
    const handler = new FeishuTaskCardActionHandler(
      config as never,
      repository as never,
    );

    const result = await handler.handle({
      type: 'card_action',
      action: {
        value: {
          action: 'task_progress_completed',
          taskId: task.id,
          taskNo: task.task_no,
          token,
        },
      },
    });

    expect(repository.save).not.toHaveBeenCalled();
    expect(task.status).toBe('in_progress');
    expect(result).toEqual(
      expect.objectContaining({
        handled: true,
        response: expect.objectContaining({
          toast: expect.objectContaining({ type: 'warning' }),
        }),
      }),
    );
    const card = result?.response.card as {
      elements: Array<{ actions?: Array<{ url?: string }> }>;
    };
    expect(card.elements[1].actions?.[0].url).toContain('/asset-sheet.html');
    expect(card.elements[1].actions?.[0].url).toContain('start=1');
  });
});
