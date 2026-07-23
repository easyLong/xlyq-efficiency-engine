import {
  assertTaskStatusTransition,
  TaskReviewStage,
  TaskStatus,
  taskDisplayStatusLabel,
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

  it('rejects executor completion and reopening a completed task', () => {
    expect(() =>
      assertTaskStatusTransition(TaskStatus.InProgress, TaskStatus.Completed),
    ).toThrow('Invalid task status transition');
    expect(() =>
      assertTaskStatusTransition(TaskStatus.Completed, TaskStatus.InProgress),
    ).toThrow('Invalid task status transition');
  });

  it('keeps labels centralized', () => {
    expect(taskStatusLabel(TaskStatus.PendingReview)).toBe('待审核');
    expect(taskStatusLabel(TaskStatus.Completed)).toBe('已完成');
    expect(
      taskDisplayStatusLabel(
        TaskStatus.PendingReview,
        TaskReviewStage.ProductReview,
      ),
    ).toBe('待成品审核');
    expect(
      taskDisplayStatusLabel(
        TaskStatus.PendingReview,
        TaskReviewStage.CustomerReview,
      ),
    ).toBe('待客户确认');
    expect(
      taskDisplayStatusLabel(
        TaskStatus.InProgress,
        TaskReviewStage.None,
        '请调整文案',
      ),
    ).toBe('修改中');
  });
});
