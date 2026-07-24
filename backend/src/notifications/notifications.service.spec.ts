import { NotificationsService } from './notifications.service';

describe('NotificationsService idempotency', () => {
  it('delivers only once when concurrent requests use the same key', async () => {
    const messagesByKey = new Map<string, Record<string, unknown>>();
    const notificationsRepository = {
      create: jest.fn((value: Record<string, unknown>) => ({ ...value })),
      save: jest.fn((message: Record<string, unknown>) => {
        const key =
          typeof message.idempotency_key === 'string'
            ? message.idempotency_key
            : '';
        const existing = key ? messagesByKey.get(key) : null;
        if (
          key &&
          message.status === 'pending' &&
          !message.sent_at &&
          existing &&
          existing !== message
        ) {
          throw Object.assign(new Error('Duplicate entry'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
          });
        }
        if (key) {
          messagesByKey.set(key, message);
        }
        return message;
      }),
      findOne: jest.fn(
        (options: { where?: { idempotency_key?: string } }) =>
          messagesByKey.get(options.where?.idempotency_key ?? '') ?? null,
      ),
    };
    const usersRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        feishu_open_id: 'ou_test',
        email: null,
      }),
    };
    const feishuService = {
      sendAppMessage: jest.fn().mockResolvedValue({ status: 'sent' }),
    };
    const dataSource = {
      query: jest.fn((sql: string) =>
        sql.includes('information_schema') ? [{ count: 1 }] : [],
      ),
    };
    const unusedRepository = {};
    const service = new NotificationsService(
      notificationsRepository as never,
      usersRepository as never,
      unusedRepository as never,
      unusedRepository as never,
      unusedRepository as never,
      unusedRepository as never,
      unusedRepository as never,
      feishuService as never,
      dataSource as never,
    );
    const dto = {
      recipientUserId: '11111111-1111-4111-8111-111111111111',
      title: 'AI需求待派发',
      content: '测试需求',
      objectType: 'ai_preview_candidate',
      objectId: '22222222-2222-4222-8222-222222222222',
      channels: ['feishu_app'],
    };
    const options = {
      idempotencyKey:
        'ai-preview-candidate:22222222-2222-4222-8222-222222222222:dispatcher:11111111-1111-4111-8111-111111111111',
    };

    await Promise.all([service.send(dto, options), service.send(dto, options)]);

    expect(messagesByKey.size).toBe(1);
    expect(feishuService.sendAppMessage).toHaveBeenCalledTimes(1);
    expect(notificationsRepository.findOne).toHaveBeenCalledWith({
      where: { idempotency_key: options.idempotencyKey },
      withDeleted: true,
    });
  });
});
