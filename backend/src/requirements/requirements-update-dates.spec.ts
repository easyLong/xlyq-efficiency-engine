import { BadRequestException } from '@nestjs/common';
import { RequirementsService } from './requirements.service';

describe('historical requirement task dates', () => {
  function setup() {
    const requirement = { id: 'requirement-1', customer_code: 'fund' };
    const item = { id: 'item-1' };
    const task = {
      id: 'task-1',
      planned_start_at: new Date('2026-10-01T08:30:00Z'),
      planned_end_at: new Date('2026-10-31T10:00:00Z'),
    };
    const requirementsRepository = { save: jest.fn(async (row) => row) };
    const tasksRepository = {
      findOne: jest.fn().mockResolvedValue(task),
      save: jest.fn(async (row) => row),
    };
    const service = Object.assign(Object.create(RequirementsService.prototype), {
      findOne: jest.fn().mockResolvedValue(requirement),
      assertCanDispatchCustomer: jest.fn().mockResolvedValue(undefined),
      requirementsRepository,
      requirementItemsRepository: {
        find: jest.fn().mockResolvedValue([item]),
        save: jest.fn(async (row) => row),
      },
      tasksRepository,
    }) as RequirementsService;
    return { service, task, tasksRepository, requirementsRepository };
  }

  it('saves a date-only edit to the linked task, including the settlement date', async () => {
    const { service, tasksRepository } = setup();
    const result = await service.update('requirement-1', {
      plannedStartAt: '2026-09-01',
      plannedEndAt: '2026-09-30',
    });
    expect(tasksRepository.save).toHaveBeenCalledTimes(1);
    expect(result.task?.planned_start_at).toEqual(new Date('2026-09-01'));
    expect(result.task?.planned_end_at).toEqual(new Date('2026-09-30'));
  });

  it('retains existing dates and times when editing other fields', async () => {
    const { service, task } = setup();
    await service.update('requirement-1', { rawContent: 'Updated content' });
    expect(task.planned_start_at).toEqual(new Date('2026-10-01T08:30:00Z'));
    expect(task.planned_end_at).toEqual(new Date('2026-10-31T10:00:00Z'));
  });

  it('allows clearing a date without clearing the other date', async () => {
    const { service } = setup();
    const result = await service.update('requirement-1', { plannedStartAt: null });
    expect(result.task?.planned_start_at).toBeNull();
    expect(result.task?.planned_end_at).toEqual(new Date('2026-10-31T10:00:00Z'));
  });

  it.each([
    { plannedStartAt: '2026-11-01' },
    { plannedEndAt: '2026-09-30' },
    { plannedEndAt: 'invalid' },
  ])('rejects invalid dates before saving any changes: %j', async (dates) => {
    const { service, tasksRepository, requirementsRepository } = setup();
    await expect(service.update('requirement-1', dates)).rejects.toThrow(BadRequestException);
    expect(tasksRepository.save).not.toHaveBeenCalled();
    expect(requirementsRepository.save).not.toHaveBeenCalled();
  });
});
