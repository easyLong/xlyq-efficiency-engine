import { TaskReviewStage, TaskStatus } from './task-status';

export enum TaskWorkflowStep {
  Dispatch = 'dispatch',
  Execute = 'execute',
  FirstReview = 'first_review',
  SecondReview = 'second_review',
  Done = 'done',
  Cancelled = 'cancelled',
}

export const TASK_WORKFLOW_STEPS = Object.values(TaskWorkflowStep);

type WorkflowTaskLike = {
  status: string;
  review_stage?: string | null;
  current_step?: string | null;
};

export function isTaskWorkflowStep(
  value?: string | null,
): value is TaskWorkflowStep {
  return TASK_WORKFLOW_STEPS.includes(value as TaskWorkflowStep);
}

export function deriveTaskWorkflowStep(
  task: WorkflowTaskLike,
): TaskWorkflowStep {
  if (isTaskWorkflowStep(task.current_step)) {
    return task.current_step;
  }
  if (task.status === TaskStatus.Completed) {
    return TaskWorkflowStep.Done;
  }
  if (task.status === TaskStatus.Cancelled) {
    return TaskWorkflowStep.Cancelled;
  }
  if (task.status === TaskStatus.PendingReview) {
    return task.review_stage === TaskReviewStage.CustomerReview
      ? TaskWorkflowStep.SecondReview
      : TaskWorkflowStep.FirstReview;
  }
  if (
    [TaskStatus.Todo, TaskStatus.Pending].includes(task.status as TaskStatus)
  ) {
    return TaskWorkflowStep.Dispatch;
  }
  return TaskWorkflowStep.Execute;
}

export function taskWorkflowStepLabel(step?: string | null) {
  return (
    {
      [TaskWorkflowStep.Dispatch]: '待派发',
      [TaskWorkflowStep.Execute]: '任务执行',
      [TaskWorkflowStep.FirstReview]: '待一审',
      [TaskWorkflowStep.SecondReview]: '待二审',
      [TaskWorkflowStep.Done]: '已验收',
      [TaskWorkflowStep.Cancelled]: '已取消',
    }[step ?? ''] ??
    step ??
    '-'
  );
}

export function reviewStageToWorkflowStep(stage?: string | null) {
  if (stage === TaskReviewStage.ProductReview) {
    return TaskWorkflowStep.FirstReview;
  }
  if (stage === TaskReviewStage.CustomerReview) {
    return TaskWorkflowStep.SecondReview;
  }
  return null;
}
