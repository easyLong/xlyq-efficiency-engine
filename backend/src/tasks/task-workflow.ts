import { TaskEntity } from './entities/task.entity';
import {
  TaskReviewStage,
  TaskStatus,
  taskDisplayStatusLabel,
} from './task-status';
import {
  deriveTaskWorkflowStep,
  TaskWorkflowStep,
  taskWorkflowStepLabel,
} from './task-workflow-state';

export type TaskWorkflowAction =
  | 'assign'
  | 'open_asset_sheet'
  | 'submit_delivery'
  | 'review_delivery'
  | 'return_revision';

export type TaskWorkflowSnapshot = {
  status: string;
  reviewStage: string;
  currentStep: TaskWorkflowStep;
  currentStepLabel: string;
  deliveryVersion: number;
  returnedFromStep: string | null;
  statusLabel: string;
  phase: 'intake' | 'assigned' | 'working' | 'review' | 'done' | 'blocked';
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
    | 'status'
    | 'review_stage'
    | 'assignee_user_id'
    | 'progress_percent'
    | 'actual_end_at'
    | 'blocked_reason'
  > &
    Partial<
      Pick<
        TaskEntity,
        'current_step' | 'delivery_version' | 'returned_from_step'
      >
    >,
): TaskWorkflowSnapshot {
  const status = task.status as TaskStatus;
  const reviewStage = (task.review_stage ??
    TaskReviewStage.None) as TaskReviewStage;
  const hasAssignee = Boolean(task.assignee_user_id);
  const currentStep = deriveTaskWorkflowStep(task);
  const actions = new Set<TaskWorkflowAction>();

  if (currentStep === TaskWorkflowStep.Dispatch) {
    actions.add('assign');
  }

  if (hasAssignee) {
    actions.add('open_asset_sheet');
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
    actions.add('submit_delivery');
  }

  if (status === TaskStatus.PendingReview) {
    actions.add('review_delivery');
    actions.add('return_revision');
  }

  const availableActions = [...actions];
  return {
    status,
    reviewStage,
    currentStep,
    currentStepLabel: taskWorkflowStepLabel(currentStep),
    deliveryVersion: Number(task.delivery_version ?? 0),
    returnedFromStep: task.returned_from_step ?? null,
    statusLabel: taskDisplayStatusLabel(
      status,
      reviewStage,
      task.blocked_reason,
    ),
    phase: workflowPhase(status),
    nextAction: nextWorkflowAction(status, availableActions),
    nextActionLabel: nextWorkflowActionLabel(status, availableActions),
    availableActions,
    canOpenAssetSheet: actions.has('open_asset_sheet'),
    canSubmitDelivery: actions.has('submit_delivery'),
    canReviewDelivery: actions.has('review_delivery'),
    canReopen: false,
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
    return pick(availableActions, 'submit_delivery');
  }
  if (status === TaskStatus.PendingReview) {
    return pick(availableActions, 'review_delivery');
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
    } satisfies Record<TaskWorkflowAction, string>
  )[action];
}

function pick(
  availableActions: TaskWorkflowAction[],
  ...candidates: TaskWorkflowAction[]
) {
  return candidates.find((action) => availableActions.includes(action)) ?? null;
}
