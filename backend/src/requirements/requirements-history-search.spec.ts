import { searchHistoryRequirements } from './requirement-history-search';
import { RequirementsService } from './requirements.service';

describe('requirement history keyword search', () => {
  const user = { id: 'dispatcher-1', username: 'dispatcher.user' };

  function createService(withItems = true) {
    const requirements = Array.from({ length: 81 }, (_, index) => ({
      id: `requirement-${index}`,
      requirement_code: index === 80 ? 'REQ-TARGET-0081' : `REQ-${index}`,
      title: `Archive demand ${index}`,
      customer_code: 'Aitui',
      business_category: 'content',
    }));
    requirements.push({
      id: 'foreign',
      requirement_code: 'REQ-FOREIGN',
      title: 'Foreign demand',
      customer_code: 'OtherFund',
      business_category: 'content',
    });
    const items = withItems
      ? requirements.map((requirement) => ({
          id: `item-${requirement.id}`,
          requirement_id: requirement.id,
          item_title: 'Deliverable',
        }))
      : [];
    const tasks = items.map((item, index) => ({
      id: `task-${index}`,
      requirement_item_id: item.id,
      task_no: `TASK-${index}`,
      task_name: index >= 80 ? 'Deep KOC draft' : `Video script ${index}`,
      status: 'todo',
    }));
    const service = Object.assign(
      Object.create(RequirementsService.prototype),
      {
        requirementsRepository: {
          find: jest.fn().mockResolvedValue(requirements),
        },
        requirementItemsRepository: {
          find: jest.fn().mockResolvedValue(items),
        },
        tasksRepository: { find: jest.fn().mockResolvedValue(tasks) },
        dataSource: {
          query: jest.fn(async (sql: string) =>
            sql.includes('FROM customer_workflow_members') &&
            sql.includes("role_code = 'dispatcher'")
              ? [{ customer_code: 'Aitui' }]
              : [],
          ),
        },
        taskWorkflowRuntime: {
          findHandledTaskIds: jest.fn().mockResolvedValue(new Set()),
        },
      },
    ) as RequirementsService;
    return { service, requirements, items, tasks };
  }

  it.each([
    'target-0081',
    'ｒｅｑ－ｔａｒｇｅｔ',
    'archive demand 80',
    'Deep   KOC',
  ])(
    'finds a matching historical code or title beyond the first page: %s',
    async (keyword) => {
      const { service } = createService();
      const result = await service.historyBoard(user as never, false, {
        keyword,
        page: 1,
        pageSize: 80,
        workflow: 'none',
      });
      expect(result.requirements.map((row) => row.id)).toEqual([
        'requirement-80',
      ]);
      expect(result.pagination?.total).toBe(1);
      expect(result.tasks.map((row) => row.id)).toEqual(['task-80']);
    },
  );

  it('does not return or count search matches outside the dispatch scope', async () => {
    const { service } = createService();
    const options = {
      keyword: 'req-foreign',
      page: 1,
      pageSize: 80,
      workflow: 'none' as const,
    };
    const scoped = await service.historyBoard(user as never, false, options);
    expect(scoped.requirements).toEqual([]);
    expect(scoped.pagination?.total).toBe(0);
    const global = await service.historyBoard(user as never, true, options);
    expect(global.requirements.map((row) => row.id)).toEqual(['foreign']);
  });

  it('restores normal scoped pagination when the keyword is cleared', async () => {
    const { service } = createService();
    const result = await service.historyBoard(user as never, false, {
      keyword: '   ',
      page: 1,
      pageSize: 80,
      workflow: 'none',
    });
    expect(result.requirements).toHaveLength(80);
    expect(result.pagination).toMatchObject({ total: 81, hasMore: true });
  });

  it('applies scope and keyword matching when demands have no items yet', async () => {
    const { service } = createService(false);
    const result = await service.historyBoard(user as never, false, {
      keyword: 'target',
      page: 1,
      pageSize: 80,
      workflow: 'none',
    });
    expect(result.requirements.map((row) => row.id)).toEqual([
      'requirement-80',
    ]);
    expect(result.tasks).toEqual([]);
  });

  it('treats percent and underscore as literal search text', () => {
    const requirements = [
      { id: 'a', title: 'Growth 10%_fund', requirement_code: 'REQ-A' },
      { id: 'b', title: 'Growth 100 fund', requirement_code: 'REQ-B' },
    ];
    expect(
      searchHistoryRequirements(requirements, [], [], '%_').map(
        (row) => row.id,
      ),
    ).toEqual(['a']);
  });
});
