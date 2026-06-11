import { TaskEntity } from './entities/task.entity';
import { TaskStatus, taskStatusLabel } from './task-status';

export type TaskWorkflowAction =
  | 'assign'
  | 'open_asset_sheet'
  | 'submit_delivery'
  | 'review_delivery'
  | 'return_revision'
  | 'reopen'
  | 'complete';

export type TaskWorkflowSnapshot = {
  status: string;
  statusLabel: string;
  phase:
    | 'intake'
    | 'assigned'
    | 'working'
    | 'review'
    | 'done'
    | 'blocked';
  nextAction: TaskWorkflowAction | null;
  nextActionLabel: string;
  availableActions: TaskWorkflowAction[];
  canOpenAssetSheet: boolean;
  canSubmitDelivery: boolean;
  canReviewDelivery: boolean;
  canReopen: boolean;
  progressPercent: number;
};

export function buildTaskWorkflowSnapshot(
  task: Pick<
    TaskEntity,
    'status' | 'assignee_user_id' | 'progress_percent' | 'actual_end_at'
  >,
): TaskWorkflowSnapshot {
  const status = task.status as TaskStatus;
  const hasAssignee = Boolean(task.assignee_user_id);
  const actions = new Set<TaskWorkflowAction>();

  if ([TaskStatus.Todo, TaskStatus.Pending].includes(status)) {
    actions.add('assign');
  }

  if (
    hasAssignee &&
    [
      TaskStatus.Todo,
      TaskStatus.Pending,
      TaskStatus.Assigned,
      TaskStatus.InProgress,
      TaskStatus.Blocked,
      TaskStatus.Returned,
    ].includes(status)
  ) {
    actions.add('open_asset_sheet');
    actions.add('submit_delivery');
  }

  if (status === TaskStatus.PendingReview) {
    actions.add('review_delivery');
    actions.add('return_revision');
  }

  if (status === TaskStatus.Completed) {
    actions.add('reopen');
  }

  if ([TaskStatus.InProgress, TaskStatus.Blocked].includes(status)) {
    actions.add('complete');
  }

  const availableActions = [...actions];
  return {
    status,
    statusLabel: taskStatusLabel(status),
    phase: workflowPhase(status),
    nextAction: nextWorkflowAction(status, availableActions),
    nextActionLabel: nextWorkflowActionLabel(status, availableActions),
    availableActions,
    canOpenAssetSheet: actions.has('open_asset_sheet'),
    canSubmitDelivery: actions.has('submit_delivery'),
    canReviewDelivery: actions.has('review_delivery'),
    canReopen: actions.has('reopen'),
    progressPercent: Math.max(
      0,
      Math.min(100, Number(task.progress_percent ?? 0)),
    ),
  };
}

function workflowPhase(status: TaskStatus): TaskWorkflowSnapshot['phase'] {
  if ([TaskStatus.Todo, TaskStatus.Pending].includes(status)) {
    return 'intake';
  }
  if (status === TaskStatus.Assigned) {
    return 'assigned';
  }
  if ([TaskStatus.InProgress, TaskStatus.Returned].includes(status)) {
    return 'working';
  }
  if (status === TaskStatus.PendingReview) {
    return 'review';
  }
  if (status === TaskStatus.Completed) {
    return 'done';
  }
  return 'blocked';
}

function nextWorkflowAction(
  status: TaskStatus,
  availableActions: TaskWorkflowAction[],
) {
  if ([TaskStatus.Todo, TaskStatus.Pending].includes(status)) {
    return pick(availableActions, 'assign', 'open_asset_sheet');
  }
  if ([TaskStatus.Assigned, TaskStatus.Returned].includes(status)) {
    return pick(availableActions, 'open_asset_sheet');
  }
  if ([TaskStatus.InProgress, TaskStatus.Blocked].includes(status)) {
    return pick(availableActions, 'submit_delivery', 'complete');
  }
  if (status === TaskStatus.PendingReview) {
    return pick(availableActions, 'review_delivery');
  }
  if (status === TaskStatus.Completed) {
    return pick(availableActions, 'reopen');
  }
  return null;
}

function nextWorkflowActionLabel(
  status: TaskStatus,
  availableActions: TaskWorkflowAction[],
) {
  const action = nextWorkflowAction(status, availableActions);
  if (!action) {
    return '暂无下一步';
  }
  return (
    {
      assign: '指派执行人',
      open_asset_sheet: '填写项目资产',
      submit_delivery: '提交交付',
      review_delivery: '验收交付',
      return_revision: '退回修改',
      reopen: '再次打开',
      complete: '标记完成',
    } satisfies Record<TaskWorkflowAction, string>
  )[action];
}

function pick(
  availableActions: TaskWorkflowAction[],
  ...candidates: TaskWorkflowAction[]
) {
  return candidates.find((action) => availableActions.includes(action)) ?? null;
}
