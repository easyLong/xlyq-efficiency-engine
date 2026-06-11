import { BadRequestException } from '@nestjs/common';

export enum TaskStatus {
  Todo = 'todo',
  Pending = 'pending',
  Assigned = 'assigned',
  InProgress = 'in_progress',
  Blocked = 'blocked',
  PendingReview = 'pending_review',
  Completed = 'completed',
  Returned = 'returned',
}

export const TASK_STATUSES = Object.values(TaskStatus);

const transitions: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.Todo]: [
    TaskStatus.Assigned,
    TaskStatus.InProgress,
    TaskStatus.Blocked,
    TaskStatus.PendingReview,
    TaskStatus.Returned,
  ],
  [TaskStatus.Pending]: [
    TaskStatus.Assigned,
    TaskStatus.InProgress,
    TaskStatus.Blocked,
    TaskStatus.PendingReview,
  ],
  [TaskStatus.Assigned]: [
    TaskStatus.Todo,
    TaskStatus.InProgress,
    TaskStatus.Blocked,
    TaskStatus.PendingReview,
    TaskStatus.Returned,
  ],
  [TaskStatus.InProgress]: [
    TaskStatus.Blocked,
    TaskStatus.PendingReview,
    TaskStatus.Completed,
    TaskStatus.Returned,
  ],
  [TaskStatus.Blocked]: [
    TaskStatus.InProgress,
    TaskStatus.PendingReview,
    TaskStatus.Completed,
    TaskStatus.Returned,
  ],
  [TaskStatus.PendingReview]: [
    TaskStatus.InProgress,
    TaskStatus.Completed,
    TaskStatus.Returned,
  ],
  [TaskStatus.Completed]: [TaskStatus.InProgress, TaskStatus.Returned],
  [TaskStatus.Returned]: [
    TaskStatus.InProgress,
    TaskStatus.PendingReview,
    TaskStatus.Completed,
  ],
};

export function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

export function assertTaskStatus(value: string): TaskStatus {
  if (!isTaskStatus(value)) {
    throw new BadRequestException(`Unsupported task status: ${value}`);
  }
  return value;
}

export function assertTaskStatusTransition(
  from: string,
  to: string,
): TaskStatus {
  const source = assertTaskStatus(from);
  const target = assertTaskStatus(to);
  if (source === target) {
    return target;
  }
  if (!transitions[source].includes(target)) {
    throw new BadRequestException(
      `Invalid task status transition: ${source} -> ${target}`,
    );
  }
  return target;
}

export function taskStatusLabel(status: string | null) {
  return (
    {
      [TaskStatus.Todo]: '未开始',
      [TaskStatus.Pending]: '待处理',
      [TaskStatus.Assigned]: '已指派',
      [TaskStatus.InProgress]: '进行中',
      [TaskStatus.Blocked]: '已停滞',
      [TaskStatus.PendingReview]: '待验收',
      [TaskStatus.Completed]: '已完成',
      [TaskStatus.Returned]: '已退回',
    }[status ?? ''] ??
    status ??
    '-'
  );
}
