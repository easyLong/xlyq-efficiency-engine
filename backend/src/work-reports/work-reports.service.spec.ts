import { BadRequestException } from '@nestjs/common';
import { WorkReportsService } from './work-reports.service';

describe('WorkReportsService', () => {
  function createFixture() {
    const dataSource = {
      query: jest.fn(),
      transaction: jest.fn(),
    };
    const notificationsService = { send: jest.fn() };
    const workflowConfigsService = {
      findGlobalMemberIds: jest.fn().mockResolvedValue([]),
    };
    return {
      dataSource,
      notificationsService,
      workflowConfigsService,
      service: new WorkReportsService(
        dataSource as never,
        notificationsService as never,
        workflowConfigsService as never,
      ),
    };
  }

  it('returns the fixed report category tree', async () => {
    const { service } = createFixture();

    await expect(service.getConfig()).resolves.toEqual({
      categories: [
        {
          code: 'customer_operation',
          name: '客户经营',
          secondaries: ['客户管理', '需求与交付'],
        },
        {
          code: 'internal_management',
          name: '内部管理',
          secondaries: ['日常管理', '内部协同', '流程建设'],
        },
      ],
      recipients: [],
    });
  });

  it('rejects a secondary category outside its selected category', async () => {
    const { service } = createFixture();

    await expect(
      service.create(
        {
          businessCategory: 'customer_operation',
          secondaryCategory: '日常管理',
          title: '本周进展',
          content: '已完成客户沟通。',
        },
        { id: 'reporter-1' } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
