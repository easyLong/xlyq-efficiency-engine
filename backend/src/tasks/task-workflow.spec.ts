import { TaskStatus } from './task-status';
import { buildTaskWorkflowSnapshot } from './task-workflow';

describe('task workflow snapshot', () => {
  const baseTask = {
    status: TaskStatus.Assigned,
    assignee_user_id: 'user-1',
    progress_percent: 0,
    actual_end_at: null,
  };

  it('guides assigned tasks into asset delivery', () => {
    const snapshot = buildTaskWorkflowSnapshot(baseTask);

    expect(snapshot.phase).toBe('assigned');
    expect(snapshot.nextAction).toBe('open_asset_sheet');
    expect(snapshot.canOpenAssetSheet).toBe(true);
    expect(snapshot.canSubmitDelivery).toBe(true);
  });

  it('guides pending review tasks into manager review', () => {
    const snapshot = buildTaskWorkflowSnapshot({
      ...baseTask,
      status: TaskStatus.PendingReview,
      progress_percent: 90,
    });

    expect(snapshot.phase).toBe('review');
    expect(snapshot.nextAction).toBe('review_delivery');
    expect(snapshot.canReviewDelivery).toBe(true);
  });

  it('guides completed tasks into reopen only', () => {
    const snapshot = buildTaskWorkflowSnapshot({
      ...baseTask,
      status: TaskStatus.Completed,
      progress_percent: 100,
    });

    expect(snapshot.phase).toBe('done');
    expect(snapshot.nextAction).toBe('reopen');
    expect(snapshot.canReopen).toBe(true);
    expect(snapshot.canSubmitDelivery).toBe(false);
  });
});
