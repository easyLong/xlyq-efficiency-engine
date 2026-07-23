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
  Cancelled = 'cancelled',
}

export const TASK_STATUSES = Object.values(TaskStatus);

export enum TaskReviewStage {
  None = 'none',
  ProductReview = 'product_review',
  CustomerReview = 'customer_review',
  Done = 'done',
}

export const TASK_REVIEW_STAGES = Object.values(TaskReviewStage);

const transitions: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.Todo]: [
    TaskStatus.Assigned,
    TaskStatus.InProgress,
    TaskStatus.PendingReview,
    TaskStatus.Cancelled,
  ],
  [TaskStatus.Pending]: [
    TaskStatus.Assigned,
    TaskStatus.InProgress,
    TaskStatus.PendingReview,
    TaskStatus.Cancelled,
  ],
  [TaskStatus.Assigned]: [
    TaskStatus.InProgress,
    TaskStatus.Blocked,
    TaskStatus.PendingReview,
    TaskStatus.Cancelled,
  ],
  [TaskStatus.InProgress]: [
    TaskStatus.Blocked,
    TaskStatus.PendingReview,
    TaskStatus.Cancelled,
  ],
  [TaskStatus.Blocked]: [
    TaskStatus.InProgress,
    TaskStatus.PendingReview,
    TaskStatus.Cancelled,
  ],
  [TaskStatus.PendingReview]: [
    TaskStatus.Returned,
    TaskStatus.Completed,
    TaskStatus.Cancelled,
  ],
  [TaskStatus.Completed]: [],
  [TaskStatus.Returned]: [
    TaskStatus.Assigned,
    TaskStatus.InProgress,
    TaskStatus.PendingReview,
    TaskStatus.Cancelled,
  ],
  [TaskStatus.Cancelled]: [],
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
      [TaskStatus.PendingReview]: '待审核',
      [TaskStatus.Completed]: '已验收',
      [TaskStatus.Returned]: '已退回',
      [TaskStatus.Cancelled]: '已取消',
    }[status ?? ''] ??
    status ??
    '-'
  );
}

export function taskReviewStageLabel(stage: string | null) {
  return (
    {
      [TaskReviewStage.None]: '无审核',
      [TaskReviewStage.ProductReview]: '待一审',
      [TaskReviewStage.CustomerReview]: '待二审',
      [TaskReviewStage.Done]: '已完成',
    }[stage ?? ''] ??
    stage ??
    '-'
  );
}

export function taskDisplayStatusLabel(
  status: string | null,
  reviewStage?: string | null,
  returnReason?: string | null,
) {
  if (status === TaskStatus.PendingReview) {
    if (reviewStage === TaskReviewStage.ProductReview) return '待一审';
    if (reviewStage === TaskReviewStage.CustomerReview) return '待二审';
  }
  if (status === TaskStatus.Completed) {
    return '已验收';
  }
  if (status === TaskStatus.Returned) {
    return '待修改';
  }
  if (status === TaskStatus.InProgress && returnReason) {
    return '修改中';
  }
  return taskStatusLabel(status);
}
