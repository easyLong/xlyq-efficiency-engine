import {
  assertTaskStatusTransition,
  TaskStatus,
  taskStatusLabel,
} from './task-status';

describe('task status state machine', () => {
  it('allows the normal assignment and delivery review flow', () => {
    expect(
      assertTaskStatusTransition(TaskStatus.Todo, TaskStatus.Assigned),
    ).toBe(TaskStatus.Assigned);
    expect(
      assertTaskStatusTransition(TaskStatus.Assigned, TaskStatus.InProgress),
    ).toBe(TaskStatus.InProgress);
    expect(
      assertTaskStatusTransition(
        TaskStatus.InProgress,
        TaskStatus.PendingReview,
      ),
    ).toBe(TaskStatus.PendingReview);
    expect(
      assertTaskStatusTransition(
        TaskStatus.PendingReview,
        TaskStatus.Completed,
      ),
    ).toBe(TaskStatus.Completed);
  });

  it('rejects skipping manager review from a new task', () => {
    expect(() =>
      assertTaskStatusTransition(TaskStatus.Todo, TaskStatus.Completed),
    ).toThrow('Invalid task status transition');
  });

  it('keeps labels centralized', () => {
    expect(taskStatusLabel(TaskStatus.PendingReview)).toBe('待验收');
    expect(taskStatusLabel(TaskStatus.Completed)).toBe('已完成');
  });
});
