import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  AccessProfile,
  buildAccessProfile,
  normalizeAccessBusinessCategory,
} from '../common/access-control';
import { UserEntity } from '../users/entities/user.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskReviewStage, TaskStatus } from './task-status';
import {
  deriveTaskWorkflowStep,
  TaskWorkflowStep,
  taskWorkflowStepLabel,
} from './task-workflow-state';

export type TaskWorkItemStatus = 'open' | 'claimed' | 'completed' | 'cancelled';

export type TaskRoleCode =
  | 'dispatcher'
  | 'executor'
  | 'first_reviewer'
  | 'second_reviewer'
  | 'owner';

export type TaskRoleState = {
  roleCode: TaskRoleCode;
  roleLabel: string;
  statusKey: string;
  statusLabel: string;
  bucket: 'todo' | 'active' | 'waiting' | 'attention' | 'done';
  actionable: boolean;
  availableActions: string[];
  actorUserId: string | null;
  actorName: string | null;
  candidateUserIds: string[];
  candidateNames: string[];
  deliveryVersion: number;
  result: string | null;
  remark: string | null;
};

export type TaskWorkflowView = {
  global: {
    status: string;
    statusLabel: string;
    currentStep: TaskWorkflowStep;
    currentStepLabel: string;
    deliveryVersion: number;
    returnedFromStep: string | null;
    returnedFromStepLabel: string | null;
  };
  primaryMyState: TaskRoleState | null;
  myStates: TaskRoleState[];
  roleStates?: TaskRoleState[];
  riskTags: string[];
};

type QueryExecutor = Pick<DataSource, 'query'> | Pick<EntityManager, 'query'>;

type TaskFacts = {
  businessCategory: string | null;
  customerCode: string | null;
};

type WorkItemCandidate = {
  userId: string;
  userName: string | null;
  status: string;
};

type WorkItemRow = {
  id: string;
  taskId: string;
  stepType: TaskWorkflowStep;
  deliveryVersion: number;
  status: TaskWorkItemStatus;
  claimedByUserId: string | null;
  actorName: string | null;
  result: string | null;
  remark: string | null;
  openedAt: Date | string | null;
  closedAt: Date | string | null;
  candidates: WorkItemCandidate[];
};

@Injectable()
export class TaskWorkflowRuntimeService {
  constructor(private readonly dataSource: DataSource) {}

  async ensureSchema() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS task_work_items (
        id CHAR(36) NOT NULL,
        task_id CHAR(36) NOT NULL,
        step_type VARCHAR(32) NOT NULL,
        delivery_version INT NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        claimed_by_user_id CHAR(36) NULL,
        result VARCHAR(32) NULL,
        remark VARCHAR(1000) NULL,
        opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        claimed_at DATETIME NULL,
        closed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_task_work_items_task_status (task_id, status, created_at),
        KEY idx_task_work_items_step_status (step_type, status, opened_at),
        KEY idx_task_work_items_actor (claimed_by_user_id, closed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务角色工作项'
    `);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS task_work_item_candidates (
        id CHAR(36) NOT NULL,
        work_item_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        candidate_source VARCHAR(32) NOT NULL DEFAULT 'workflow_config',
        notified_at DATETIME NULL,
        seen_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_task_work_item_candidate (work_item_id, user_id),
        KEY idx_task_work_item_candidates_user (user_id, status, created_at),
        KEY idx_task_work_item_candidates_item (work_item_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务工作项候选人'
    `);
  }

  async normalizeLegacyTaskState() {
    await this.dataSource.query(`
      UPDATE tasks task
      JOIN (
        SELECT record.task_id, record.review_stage
        FROM task_review_records record
        JOIN (
          SELECT task_id, MAX(created_at) AS latest_at
          FROM task_review_records
          WHERE deleted_at IS NULL AND review_result = 'returned'
          GROUP BY task_id
        ) latest
          ON latest.task_id = record.task_id
         AND latest.latest_at = record.created_at
        WHERE record.deleted_at IS NULL
          AND record.review_result = 'returned'
      ) returned_record ON returned_record.task_id = task.id
      SET task.status = 'returned',
          task.returned_from_step = CASE
            WHEN returned_record.review_stage = 'product_review' THEN 'first_review'
            ELSE 'second_review'
          END,
          task.current_step = 'execute',
          task.updated_at = task.updated_at
      WHERE task.deleted_at IS NULL
        AND task.status = 'in_progress'
        AND task.review_stage = 'none'
        AND task.blocked_reason IS NOT NULL
    `);
    await this.dataSource.query(`
      UPDATE tasks task
      SET task.current_step = CASE
            WHEN task.status = 'completed' THEN 'done'
            WHEN task.status = 'cancelled' THEN 'cancelled'
            WHEN task.status = 'pending_review' AND task.review_stage = 'customer_review' THEN 'second_review'
            WHEN task.status = 'pending_review' THEN 'first_review'
            WHEN task.status IN ('todo', 'pending') THEN 'dispatch'
            ELSE 'execute'
          END,
          task.delivery_version = GREATEST(
            COALESCE(task.delivery_version, 0),
            CASE WHEN task.status IN ('pending_review', 'completed', 'returned') THEN 1 ELSE 0 END
          ),
          task.last_transition_at = COALESCE(task.last_transition_at, task.updated_at),
          task.updated_at = task.updated_at
      WHERE task.deleted_at IS NULL
        AND (
          task.current_step IS NULL
          OR task.current_step = ''
          OR task.last_transition_at IS NULL
          OR task.delivery_version IS NULL
        )
    `);
    await this.dataSource.query(`
      UPDATE tasks task
      LEFT JOIN (
        SELECT task_id, COUNT(*) AS submitted_count
        FROM task_review_records
        WHERE deleted_at IS NULL AND review_result = 'submitted'
        GROUP BY task_id
      ) delivery ON delivery.task_id = task.id
      SET task.delivery_version = GREATEST(
            COALESCE(task.delivery_version, 0),
            COALESCE(delivery.submitted_count, 0)
          ),
          task.updated_at = task.updated_at
      WHERE task.deleted_at IS NULL
    `);
  }

  async reconcileOpenWorkItems() {
    await this.ensureSchema();
    await this.dataSource.query(`
      INSERT INTO task_work_items (
        id, task_id, step_type, delivery_version, status, opened_at
      )
      SELECT
        UUID(), task.id, task.current_step, COALESCE(task.delivery_version, 0),
        'open', COALESCE(task.last_transition_at, task.updated_at, CURRENT_TIMESTAMP)
      FROM tasks task
      WHERE task.deleted_at IS NULL
        AND task.current_step IN ('dispatch', 'execute', 'first_review', 'second_review')
        AND NOT EXISTS (
          SELECT 1
          FROM task_work_items item
          WHERE item.task_id = task.id
            AND item.step_type = task.current_step
            AND item.delivery_version = COALESCE(task.delivery_version, 0)
            AND item.status IN ('open', 'claimed')
            AND item.deleted_at IS NULL
        )
    `);
    await this.backfillOpenWorkItemCandidates();
  }

  private async backfillOpenWorkItemCandidates() {
    await this.dataSource.query(`
      INSERT IGNORE INTO task_work_item_candidates (
        id, work_item_id, user_id, status, candidate_source
      )
      SELECT UUID(), item.id, task.dispatcher_user_id, 'open', 'task_actor'
      FROM task_work_items item
      JOIN tasks task ON task.id = item.task_id AND task.deleted_at IS NULL
      WHERE item.deleted_at IS NULL
        AND item.status IN ('open', 'claimed')
        AND item.step_type = 'dispatch'
        AND task.dispatcher_user_id IS NOT NULL
    `);
    await this.dataSource.query(`
      INSERT IGNORE INTO task_work_item_candidates (
        id, work_item_id, user_id, status, candidate_source
      )
      SELECT UUID(), item.id, member.user_id, 'open', 'workflow_config'
      FROM task_work_items item
      JOIN tasks task ON task.id = item.task_id AND task.deleted_at IS NULL
      JOIN requirement_items requirement_item
        ON requirement_item.id = task.requirement_item_id
       AND requirement_item.deleted_at IS NULL
      JOIN requirements requirement
        ON requirement.id = requirement_item.requirement_id
       AND requirement.deleted_at IS NULL
      JOIN customer_workflow_members member
        ON member.customer_code = requirement.customer_code
       AND member.role_code = 'dispatcher'
       AND member.status = 'active'
       AND member.deleted_at IS NULL
      WHERE item.deleted_at IS NULL
        AND item.status IN ('open', 'claimed')
        AND item.step_type = 'dispatch'
        AND task.dispatcher_user_id IS NULL
    `);
    await this.dataSource.query(`
      INSERT IGNORE INTO task_work_item_candidates (
        id, work_item_id, user_id, status, candidate_source
      )
      SELECT UUID(), item.id, task.assignee_user_id, 'open', 'task_actor'
      FROM task_work_items item
      JOIN tasks task ON task.id = item.task_id AND task.deleted_at IS NULL
      WHERE item.deleted_at IS NULL
        AND item.status IN ('open', 'claimed')
        AND item.step_type = 'execute'
        AND task.assignee_user_id IS NOT NULL
    `);
    await this.dataSource.query(`
      INSERT IGNORE INTO task_work_item_candidates (
        id, work_item_id, user_id, status, candidate_source
      )
      SELECT UUID(), item.id, member.user_id, 'open', 'workflow_config'
      FROM task_work_items item
      JOIN tasks task ON task.id = item.task_id AND task.deleted_at IS NULL
      JOIN requirement_items requirement_item
        ON requirement_item.id = task.requirement_item_id
       AND requirement_item.deleted_at IS NULL
      JOIN requirements requirement
        ON requirement.id = requirement_item.requirement_id
       AND requirement.deleted_at IS NULL
      JOIN business_category_review_members member
        ON member.business_category_code = CASE
          WHEN requirement.business_category IN ('设计', 'design') THEN 'design'
          WHEN requirement.business_category IN ('文案', 'copywriting') THEN 'copywriting'
          WHEN requirement.business_category IN ('运营', 'operation') THEN 'operation'
          WHEN requirement.business_category IN ('社区', 'community') THEN 'community'
          ELSE requirement.business_category
        END
       AND member.status = 'active'
       AND member.deleted_at IS NULL
      WHERE item.deleted_at IS NULL
        AND item.status IN ('open', 'claimed')
        AND item.step_type = 'first_review'
        AND member.user_id <> COALESCE(task.assignee_user_id, '')
    `);
    await this.dataSource.query(`
      INSERT IGNORE INTO task_work_item_candidates (
        id, work_item_id, user_id, status, candidate_source
      )
      SELECT UUID(), item.id, member.user_id, 'open', 'workflow_config'
      FROM task_work_items item
      JOIN tasks task ON task.id = item.task_id AND task.deleted_at IS NULL
      JOIN requirement_items requirement_item
        ON requirement_item.id = task.requirement_item_id
       AND requirement_item.deleted_at IS NULL
      JOIN requirements requirement
        ON requirement.id = requirement_item.requirement_id
       AND requirement.deleted_at IS NULL
      JOIN customer_workflow_members member
        ON member.customer_code = requirement.customer_code
       AND member.role_code = 'customer_reviewer'
       AND member.status = 'active'
       AND member.deleted_at IS NULL
      WHERE item.deleted_at IS NULL
        AND item.status IN ('open', 'claimed')
        AND item.step_type = 'second_review'
        AND member.user_id <> COALESCE(task.assignee_user_id, '')
        AND member.user_id <> COALESCE(task.product_reviewer_user_id, '')
    `);
  }

  async syncTaskCurrentStep(
    task: TaskEntity,
    options: { manager?: EntityManager; forceNew?: boolean } = {},
  ) {
    const executor = options.manager ?? this.dataSource;
    const step = deriveTaskWorkflowStep(task);
    if ([TaskWorkflowStep.Done, TaskWorkflowStep.Cancelled].includes(step)) {
      await this.cancelOpenWorkItems(
        task.id,
        'workflow_finished',
        null,
        executor,
      );
      return null;
    }
    const version = Number(task.delivery_version ?? 0);
    if (options.forceNew) {
      await this.cancelOpenWorkItems(task.id, 'superseded', null, executor);
    } else {
      await executor.query(
        `
          UPDATE task_work_items
          SET status = 'cancelled',
              result = COALESCE(result, 'superseded'),
              closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE task_id = ?
            AND deleted_at IS NULL
            AND status IN ('open', 'claimed')
            AND (step_type <> ? OR delivery_version <> ?)
        `,
        [task.id, step, version],
      );
    }

    const existing: Array<{ id: string }> = await executor.query(
      `
        SELECT id
        FROM task_work_items
        WHERE task_id = ?
          AND step_type = ?
          AND delivery_version = ?
          AND status IN ('open', 'claimed')
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [task.id, step, version],
    );
    const workItemId = existing[0]?.id ?? randomUUID();
    if (!existing.length) {
      await executor.query(
        `
          INSERT INTO task_work_items (
            id, task_id, step_type, delivery_version, status, opened_at
          ) VALUES (?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)
        `,
        [workItemId, task.id, step, version],
      );
    }
    const candidateIds = await this.resolveCandidateIds(task, step, executor);
    for (const userId of candidateIds) {
      await executor.query(
        `
          INSERT INTO task_work_item_candidates (
            id, work_item_id, user_id, status, candidate_source
          ) VALUES (?, ?, ?, 'open', ?)
          ON DUPLICATE KEY UPDATE deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
        `,
        [
          randomUUID(),
          workItemId,
          userId,
          step === TaskWorkflowStep.Execute ? 'task_actor' : 'workflow_config',
        ],
      );
    }
    return workItemId;
  }

  async claimStep(
    taskId: string,
    step: TaskWorkflowStep,
    actorUserId: string,
    executor: QueryExecutor = this.dataSource,
  ) {
    const workItem = await this.latestOpenWorkItem(taskId, step, executor);
    if (!workItem) return null;
    await executor.query(
      `
        UPDATE task_work_items
        SET status = 'claimed',
            claimed_by_user_id = COALESCE(claimed_by_user_id, ?),
            claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('open', 'claimed')
      `,
      [actorUserId, workItem.id],
    );
    await executor.query(
      `
        UPDATE task_work_item_candidates
        SET status = CASE WHEN user_id = ? THEN 'claimed' ELSE status END,
            updated_at = CURRENT_TIMESTAMP
        WHERE work_item_id = ? AND deleted_at IS NULL
      `,
      [actorUserId, workItem.id],
    );
    return workItem.id;
  }

  async completeStep(
    taskId: string,
    step: TaskWorkflowStep,
    actorUserId: string | null,
    result: string,
    remark?: string | null,
    executor: QueryExecutor = this.dataSource,
  ) {
    let workItem = await this.latestOpenWorkItem(taskId, step, executor);
    if (!workItem) {
      workItem = { id: randomUUID() };
      await executor.query(
        `
          INSERT INTO task_work_items (
            id, task_id, step_type, delivery_version, status,
            claimed_by_user_id, result, remark, opened_at, claimed_at, closed_at
          )
          SELECT ?, id, ?, COALESCE(delivery_version, 0), 'completed',
                 ?, ?, ?, CURRENT_TIMESTAMP,
                 CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
                 CURRENT_TIMESTAMP
          FROM tasks WHERE id = ? AND deleted_at IS NULL
        `,
        [
          workItem.id,
          step,
          actorUserId,
          result,
          remark ?? null,
          actorUserId,
          taskId,
        ],
      );
    } else {
      await executor.query(
        `
          UPDATE task_work_items
          SET status = 'completed',
              claimed_by_user_id = COALESCE(claimed_by_user_id, ?),
              result = ?,
              remark = ?,
              claimed_at = CASE
                WHEN ? IS NULL THEN claimed_at
                ELSE COALESCE(claimed_at, CURRENT_TIMESTAMP)
              END,
              closed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status IN ('open', 'claimed')
        `,
        [actorUserId, result, remark ?? null, actorUserId, workItem.id],
      );
    }
    if (actorUserId) {
      await executor.query(
        `
          INSERT INTO task_work_item_candidates (
            id, work_item_id, user_id, status, candidate_source
          ) VALUES (?, ?, ?, 'handled', 'actual_actor')
          ON DUPLICATE KEY UPDATE status = 'handled', updated_at = CURRENT_TIMESTAMP
        `,
        [randomUUID(), workItem.id, actorUserId],
      );
      await executor.query(
        `
          UPDATE task_work_item_candidates
          SET status = CASE
                WHEN user_id = ? THEN 'handled'
                WHEN status IN ('open', 'claimed') THEN 'handled_by_other'
                ELSE status
              END,
              updated_at = CURRENT_TIMESTAMP
          WHERE work_item_id = ? AND deleted_at IS NULL
        `,
        [actorUserId, workItem.id],
      );
    }
    return workItem.id;
  }

  async cancelOpenWorkItems(
    taskId: string,
    result: string,
    remark: string | null,
    executor: QueryExecutor = this.dataSource,
  ) {
    await executor.query(
      `
        UPDATE task_work_items
        SET status = 'cancelled',
            result = COALESCE(result, ?),
            remark = COALESCE(remark, ?),
            closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE task_id = ?
          AND deleted_at IS NULL
          AND status IN ('open', 'claimed')
      `,
      [result, remark, taskId],
    );
    await executor.query(
      `
        UPDATE task_work_item_candidates candidate
        JOIN task_work_items item ON item.id = candidate.work_item_id
        SET candidate.status = CASE
              WHEN candidate.status IN ('open', 'claimed') THEN 'cancelled'
              ELSE candidate.status
            END,
            candidate.updated_at = CURRENT_TIMESTAMP
        WHERE item.task_id = ? AND candidate.deleted_at IS NULL
      `,
      [taskId],
    );
  }

  async decorateTasks(
    tasks: TaskEntity[],
    currentUser: UserEntity | null,
  ): Promise<Array<TaskEntity & { workflow_view: TaskWorkflowView }>> {
    if (!tasks.length) return [];
    const taskIds = tasks.map((task) => task.id);
    const [profile, workItems, factsByTaskId] = await Promise.all([
      currentUser
        ? buildAccessProfile(this.dataSource, currentUser)
        : Promise.resolve(null),
      this.loadWorkItems(taskIds),
      this.loadTaskFacts(taskIds),
    ]);
    const itemsByTaskId = new Map<string, WorkItemRow[]>();
    for (const item of workItems) {
      const rows = itemsByTaskId.get(item.taskId) ?? [];
      rows.push(item);
      itemsByTaskId.set(item.taskId, rows);
    }
    return tasks.map((task) =>
      Object.assign(task, {
        workflow_view: buildTaskWorkflowView(
          task,
          itemsByTaskId.get(task.id) ?? [],
          currentUser,
          profile,
          factsByTaskId.get(task.id) ?? {
            businessCategory: null,
            customerCode: null,
          },
        ),
      }),
    );
  }

  async findHandledTaskIds(userId: string, taskIds: string[]) {
    if (!userId || !taskIds.length) return new Set<string>();
    const placeholders = taskIds.map(() => '?').join(',');
    const rows: Array<{ taskId: string }> = await this.dataSource.query(
      `
        SELECT DISTINCT task_id AS taskId
        FROM task_work_items
        WHERE task_id IN (${placeholders})
          AND claimed_by_user_id = ?
          AND status = 'completed'
          AND deleted_at IS NULL
      `,
      [...taskIds, userId],
    );
    return new Set(rows.map((row) => row.taskId));
  }

  private async resolveCandidateIds(
    task: TaskEntity,
    step: TaskWorkflowStep,
    executor: QueryExecutor,
  ) {
    if (step === TaskWorkflowStep.Execute) {
      return task.assignee_user_id ? [task.assignee_user_id] : [];
    }
    if (step === TaskWorkflowStep.Dispatch && task.dispatcher_user_id) {
      return [task.dispatcher_user_id];
    }
    const facts = await this.taskFacts(task.id, executor);
    if (step === TaskWorkflowStep.Dispatch) {
      return this.configuredCustomerMemberIds(
        facts.customerCode,
        'dispatcher',
        executor,
      );
    }
    if (step === TaskWorkflowStep.FirstReview) {
      const category = normalizeAccessBusinessCategory(facts.businessCategory);
      const rows: Array<{ userId: string }> = await executor.query(
        `
          SELECT member.user_id AS userId
          FROM business_category_review_members member
          JOIN users user
            ON user.id = member.user_id
           AND user.status = 'active'
           AND user.deleted_at IS NULL
          WHERE member.business_category_code = ?
            AND member.status = 'active'
            AND member.deleted_at IS NULL
          ORDER BY member.created_at, member.user_id
        `,
        [category],
      );
      return uniqueIds(
        rows
          .map((row) => row.userId)
          .filter((id) => id !== task.assignee_user_id),
      );
    }
    if (step === TaskWorkflowStep.SecondReview) {
      const ids = await this.configuredCustomerMemberIds(
        facts.customerCode,
        'customer_reviewer',
        executor,
      );
      return ids.filter(
        (id) =>
          id !== task.assignee_user_id && id !== task.product_reviewer_user_id,
      );
    }
    return [];
  }

  private async configuredCustomerMemberIds(
    customerCode: string | null,
    roleCode: string,
    executor: QueryExecutor,
  ) {
    if (!customerCode) return [];
    const rows: Array<{ userId: string }> = await executor.query(
      `
        SELECT member.user_id AS userId
        FROM customer_workflow_members member
        JOIN users user
          ON user.id = member.user_id
         AND user.status = 'active'
         AND user.deleted_at IS NULL
        WHERE member.customer_code = ?
          AND member.role_code = ?
          AND member.status = 'active'
          AND member.deleted_at IS NULL
        ORDER BY member.created_at, member.user_id
      `,
      [customerCode, roleCode],
    );
    return uniqueIds(rows.map((row) => row.userId));
  }

  private async latestOpenWorkItem(
    taskId: string,
    step: TaskWorkflowStep,
    executor: QueryExecutor,
  ) {
    const rows: Array<{ id: string }> = await executor.query(
      `
        SELECT id
        FROM task_work_items
        WHERE task_id = ?
          AND step_type = ?
          AND status IN ('open', 'claimed')
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [taskId, step],
    );
    return rows[0] ?? null;
  }

  private async taskFacts(taskId: string, executor: QueryExecutor) {
    const rows: TaskFacts[] = await executor.query(
      `
        SELECT
          requirement.business_category AS businessCategory,
          requirement.customer_code AS customerCode
        FROM tasks task
        LEFT JOIN requirement_items item ON item.id = task.requirement_item_id
        LEFT JOIN requirements requirement ON requirement.id = item.requirement_id
        WHERE task.id = ?
        LIMIT 1
      `,
      [taskId],
    );
    return rows[0] ?? { businessCategory: null, customerCode: null };
  }

  private async loadTaskFacts(taskIds: string[]) {
    const placeholders = taskIds.map(() => '?').join(',');
    const rows: Array<TaskFacts & { taskId: string }> =
      await this.dataSource.query(
        `
        SELECT
          task.id AS taskId,
          requirement.business_category AS businessCategory,
          requirement.customer_code AS customerCode
        FROM tasks task
        LEFT JOIN requirement_items item ON item.id = task.requirement_item_id
        LEFT JOIN requirements requirement ON requirement.id = item.requirement_id
        WHERE task.id IN (${placeholders})
      `,
        taskIds,
      );
    return new Map(rows.map((row) => [row.taskId, row]));
  }

  private async loadWorkItems(taskIds: string[]) {
    const placeholders = taskIds.map(() => '?').join(',');
    const rows: Array<Omit<WorkItemRow, 'candidates'>> =
      await this.dataSource.query(
        `
          SELECT
            item.id,
            item.task_id AS taskId,
            item.step_type AS stepType,
            item.delivery_version AS deliveryVersion,
            item.status,
            item.claimed_by_user_id AS claimedByUserId,
            actor.display_name AS actorName,
            item.result,
            item.remark,
            item.opened_at AS openedAt,
            item.closed_at AS closedAt
          FROM task_work_items item
          LEFT JOIN users actor
            ON actor.id = item.claimed_by_user_id
           AND actor.deleted_at IS NULL
          WHERE item.task_id IN (${placeholders})
            AND item.deleted_at IS NULL
          ORDER BY item.created_at DESC
        `,
        taskIds,
      );
    if (!rows.length) return [];
    const itemIds = rows.map((row) => row.id);
    const itemPlaceholders = itemIds.map(() => '?').join(',');
    const candidateRows: Array<WorkItemCandidate & { workItemId: string }> =
      await this.dataSource.query(
        `
          SELECT
            candidate.work_item_id AS workItemId,
            candidate.user_id AS userId,
            user.display_name AS userName,
            candidate.status
          FROM task_work_item_candidates candidate
          JOIN users user
            ON user.id = candidate.user_id
           AND user.deleted_at IS NULL
          WHERE candidate.work_item_id IN (${itemPlaceholders})
            AND candidate.deleted_at IS NULL
          ORDER BY candidate.created_at, candidate.user_id
        `,
        itemIds,
      );
    const candidatesByItem = new Map<string, WorkItemCandidate[]>();
    for (const candidate of candidateRows) {
      const values = candidatesByItem.get(candidate.workItemId) ?? [];
      values.push(candidate);
      candidatesByItem.set(candidate.workItemId, values);
    }
    return rows.map((row) => ({
      ...row,
      deliveryVersion: Number(row.deliveryVersion ?? 0),
      candidates: candidatesByItem.get(row.id) ?? [],
    }));
  }
}

export function buildTaskWorkflowView(
  task: TaskEntity,
  workItems: WorkItemRow[],
  currentUser: UserEntity | null,
  profile: AccessProfile | null,
  facts: TaskFacts,
): TaskWorkflowView {
  const step = deriveTaskWorkflowStep(task);
  const version = Number(task.delivery_version ?? 0);
  const byStep = (target: TaskWorkflowStep) =>
    workItems.find(
      (item) =>
        item.stepType === target && ['open', 'claimed'].includes(item.status),
    ) ?? workItems.find((item) => item.stepType === target);
  const stateForRole = (
    roleCode: TaskRoleCode,
    item?: WorkItemRow,
  ): TaskRoleState => {
    if (roleCode === 'dispatcher') return dispatcherState(task, item);
    if (roleCode === 'executor') return executorState(task, item);
    if (roleCode === 'first_reviewer') {
      return reviewerState(task, roleCode, item);
    }
    if (roleCode === 'second_reviewer') {
      return reviewerState(task, roleCode, item);
    }
    return ownerState(task);
  };
  const roleCodes: TaskRoleCode[] = [
    'dispatcher',
    'executor',
    'first_reviewer',
    'second_reviewer',
    'owner',
  ];
  const roleStates = roleCodes.map((roleCode) =>
    stateForRole(roleCode, byStep(stepForRole(roleCode))),
  );
  const userId = currentUser?.id ?? null;
  const ownsCategory = Boolean(
    profile?.ownedBusinessCategoryCodes.includes(
      normalizeAccessBusinessCategory(facts.businessCategory),
    ),
  );
  const myStates = userId
    ? roleCodes
        .map((roleCode) => {
          const roleStep = stepForRole(roleCode);
          const personalItem = workItems.find(
            (item) =>
              item.stepType === roleStep &&
              (item.claimedByUserId === userId ||
                (['open', 'claimed'].includes(item.status) &&
                  item.candidates.some(
                    (candidate) =>
                      candidate.userId === userId &&
                      ['open', 'claimed'].includes(candidate.status),
                  ))),
          );
          return {
            state: stateForRole(roleCode, personalItem ?? byStep(roleStep)),
            item: personalItem ?? byStep(roleStep),
          };
        })
        .filter(({ state, item }) =>
          isRoleRelatedToUser(state.roleCode, task, item, userId, ownsCategory),
        )
        .map(({ state }) => personalizeRoleState(state, task, userId))
    : [];
  const primaryMyState =
    [...myStates].sort(
      (a, b) =>
        Number(b.actionable) - Number(a.actionable) ||
        bucketRank(a.bucket) - bucketRank(b.bucket),
    )[0] ?? null;
  const activeItem = workItems.find((item) =>
    ['open', 'claimed'].includes(item.status),
  );
  const riskTags: string[] = [];
  if (activeItem && !activeItem.candidates.length) riskTags.push('人员未配置');
  if (task.status === TaskStatus.Blocked) riskTags.push('任务受阻');
  if (
    task.planned_end_at &&
    new Date(task.planned_end_at).getTime() < Date.now() &&
    ![TaskStatus.Completed, TaskStatus.Cancelled].includes(
      task.status as TaskStatus,
    )
  ) {
    riskTags.push('已超期');
  }
  if (workItems.filter((item) => item.result === 'returned').length >= 2) {
    riskTags.push('多次打回');
  }
  return {
    global: {
      status: task.status,
      statusLabel: globalStatusLabel(task),
      currentStep: step,
      currentStepLabel: taskWorkflowStepLabel(step),
      deliveryVersion: version,
      returnedFromStep: task.returned_from_step ?? null,
      returnedFromStepLabel: task.returned_from_step
        ? taskWorkflowStepLabel(task.returned_from_step)
        : null,
    },
    primaryMyState,
    myStates,
    ...(profile?.isAdmin ? { roleStates } : {}),
    riskTags,
  };
}

function dispatcherState(task: TaskEntity, item?: WorkItemRow): TaskRoleState {
  const step = deriveTaskWorkflowStep(task);
  if (step === TaskWorkflowStep.Dispatch) {
    return roleState(
      'dispatcher',
      'pending_dispatch',
      '待派发',
      'todo',
      true,
      ['assign'],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.Completed) {
    return roleState(
      'dispatcher',
      'completed',
      '已验收',
      'done',
      false,
      [],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.Cancelled) {
    return roleState(
      'dispatcher',
      'cancelled',
      '已取消',
      'done',
      false,
      [],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.Returned) {
    return roleState(
      'dispatcher',
      'revision',
      '返修中',
      'attention',
      false,
      [],
      item,
      task,
    );
  }
  const labels: Partial<Record<TaskWorkflowStep, string>> = {
    [TaskWorkflowStep.Execute]:
      task.status === TaskStatus.Assigned ? '已派发·待开始' : '已派发·执行中',
    [TaskWorkflowStep.FirstReview]: '已派发·待一审',
    [TaskWorkflowStep.SecondReview]: '已派发·待二审',
  };
  return roleState(
    'dispatcher',
    `dispatched_${step}`,
    labels[step] ?? '已派发',
    'waiting',
    false,
    [],
    item,
    task,
  );
}

function executorState(task: TaskEntity, item?: WorkItemRow): TaskRoleState {
  if (!task.assignee_user_id) {
    return roleState(
      'executor',
      'unassigned',
      '未指派',
      'attention',
      false,
      [],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.Assigned) {
    return roleState(
      'executor',
      'pending_start',
      '待执行人开始',
      'todo',
      true,
      ['start'],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.Returned) {
    const first = task.returned_from_step === TaskWorkflowStep.FirstReview;
    return roleState(
      'executor',
      first ? 'first_review_returned' : 'second_review_returned',
      `待修改·${first ? '一审' : '二审'}退回`,
      'attention',
      true,
      ['edit_assets', 'submit_delivery'],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.Blocked) {
    return roleState(
      'executor',
      'blocked',
      '受阻待协助',
      'attention',
      true,
      ['resume'],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.InProgress) {
    return roleState(
      'executor',
      'working',
      '执行中',
      'active',
      true,
      ['edit_assets', 'submit_delivery'],
      item,
      task,
    );
  }
  if (deriveTaskWorkflowStep(task) === TaskWorkflowStep.FirstReview) {
    return roleState(
      'executor',
      'submitted_first_review',
      '已提交·待一审',
      'waiting',
      false,
      [],
      item,
      task,
    );
  }
  if (deriveTaskWorkflowStep(task) === TaskWorkflowStep.SecondReview) {
    return roleState(
      'executor',
      'submitted_second_review',
      '一审通过·待二审',
      'waiting',
      false,
      [],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.Completed) {
    return roleState(
      'executor',
      'completed',
      '已验收',
      'done',
      false,
      [],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.Cancelled) {
    return roleState(
      'executor',
      'cancelled',
      '已取消',
      'done',
      false,
      [],
      item,
      task,
    );
  }
  return roleState(
    'executor',
    'pending',
    '待处理',
    'todo',
    true,
    ['start'],
    item,
    task,
  );
}

function reviewerState(
  task: TaskEntity,
  roleCode: 'first_reviewer' | 'second_reviewer',
  item?: WorkItemRow,
): TaskRoleState {
  const expectedStep =
    roleCode === 'first_reviewer'
      ? TaskWorkflowStep.FirstReview
      : TaskWorkflowStep.SecondReview;
  const roleText = roleCode === 'first_reviewer' ? '一审' : '二审';
  const version = Number(item?.deliveryVersion ?? task.delivery_version ?? 0);
  if (
    item &&
    item.stepType === expectedStep &&
    ['open', 'claimed'].includes(item.status)
  ) {
    return roleState(
      roleCode,
      version > 1 ? 'pending_rereview' : 'pending_review',
      version > 1 ? `待复审 V${version}` : `待${roleText}`,
      'todo',
      true,
      ['approve', 'return'],
      item,
      task,
    );
  }
  if (item?.result === 'approved') {
    return roleState(
      roleCode,
      'approved',
      `已通过${version ? ` V${version}` : ''}`,
      'done',
      false,
      [],
      item,
      task,
    );
  }
  if (item?.result === 'returned') {
    return roleState(
      roleCode,
      'returned',
      `已退回${version ? ` V${version}` : ''}`,
      'done',
      false,
      [],
      item,
      task,
    );
  }
  const currentStep = deriveTaskWorkflowStep(task);
  if (
    roleCode === 'first_reviewer' &&
    ([TaskWorkflowStep.SecondReview, TaskWorkflowStep.Done].includes(
      currentStep,
    ) ||
      task.returned_from_step === TaskWorkflowStep.SecondReview)
  ) {
    return roleState(
      roleCode,
      'approved_legacy',
      task.product_reviewer_user_id
        ? `已通过${version ? ` V${version}` : ''}`
        : '历史一审已通过·人员未知',
      'done',
      false,
      [],
      item,
      task,
    );
  }
  if (roleCode === 'second_reviewer' && currentStep === TaskWorkflowStep.Done) {
    return roleState(
      roleCode,
      'approved_legacy',
      task.customer_reviewer_user_id
        ? `已通过${version ? ` V${version}` : ''}`
        : '历史二审已通过·人员未知',
      'done',
      false,
      [],
      item,
      task,
    );
  }
  if (
    task.status === TaskStatus.Returned &&
    ((roleCode === 'first_reviewer' &&
      task.returned_from_step === TaskWorkflowStep.FirstReview) ||
      (roleCode === 'second_reviewer' &&
        task.returned_from_step === TaskWorkflowStep.SecondReview))
  ) {
    return roleState(
      roleCode,
      'returned_legacy',
      `已退回${version ? ` V${version}` : ''}`,
      'done',
      false,
      [],
      item,
      task,
    );
  }
  if (task.status === TaskStatus.Cancelled) {
    return roleState(
      roleCode,
      'cancelled',
      '已取消',
      'done',
      false,
      [],
      item,
      task,
    );
  }
  return roleState(
    roleCode,
    'not_started',
    '未开始',
    'waiting',
    false,
    [],
    item,
    task,
  );
}

function ownerState(task: TaskEntity): TaskRoleState {
  const step = deriveTaskWorkflowStep(task);
  if (task.status === TaskStatus.Completed) {
    return roleState(
      'owner',
      'completed',
      '已验收',
      'done',
      false,
      [],
      undefined,
      task,
    );
  }
  if (task.status === TaskStatus.Cancelled) {
    return roleState(
      'owner',
      'cancelled',
      '已取消',
      'done',
      false,
      [],
      undefined,
      task,
    );
  }
  if (
    [TaskStatus.Returned, TaskStatus.Blocked].includes(
      task.status as TaskStatus,
    )
  ) {
    return roleState(
      'owner',
      'attention',
      '风险待协调',
      'attention',
      false,
      ['view'],
      undefined,
      task,
    );
  }
  if (
    [TaskWorkflowStep.FirstReview, TaskWorkflowStep.SecondReview].includes(step)
  ) {
    return roleState(
      'owner',
      'reviewing',
      taskWorkflowStepLabel(step),
      'waiting',
      false,
      ['view'],
      undefined,
      task,
    );
  }
  return roleState(
    'owner',
    step === TaskWorkflowStep.Dispatch ? 'pending_dispatch' : 'progressing',
    step === TaskWorkflowStep.Dispatch ? '待派发' : '推进中',
    step === TaskWorkflowStep.Dispatch ? 'attention' : 'active',
    false,
    ['view'],
    undefined,
    task,
  );
}

function roleState(
  roleCode: TaskRoleCode,
  statusKey: string,
  statusLabel: string,
  bucket: TaskRoleState['bucket'],
  actionable: boolean,
  availableActions: string[],
  item: WorkItemRow | undefined,
  task: TaskEntity,
): TaskRoleState {
  return {
    roleCode,
    roleLabel: roleLabel(roleCode),
    statusKey,
    statusLabel,
    bucket,
    actionable,
    availableActions,
    actorUserId: item?.claimedByUserId ?? actorIdForRole(task, roleCode),
    actorName: item?.actorName ?? null,
    candidateUserIds:
      item?.candidates.map((candidate) => candidate.userId) ?? [],
    candidateNames:
      item?.candidates
        .map((candidate) => candidate.userName)
        .filter((name): name is string => Boolean(name)) ?? [],
    deliveryVersion: Number(
      item?.deliveryVersion ?? task.delivery_version ?? 0,
    ),
    result: item?.result ?? null,
    remark: item?.remark ?? null,
  };
}

function isRoleRelatedToUser(
  roleCode: TaskRoleCode,
  task: TaskEntity,
  item: WorkItemRow | undefined,
  userId: string,
  ownsCategory: boolean,
) {
  if (roleCode === 'owner') {
    return ownsCategory || task.reporter_user_id === userId;
  }
  const actorId = actorIdForRole(task, roleCode);
  if (actorId === userId || item?.claimedByUserId === userId) return true;
  return Boolean(
    item &&
    ['open', 'claimed'].includes(item.status) &&
    item.candidates.some(
      (candidate) =>
        candidate.userId === userId &&
        ['open', 'claimed'].includes(candidate.status),
    ),
  );
}

function personalizeRoleState(
  state: TaskRoleState,
  task: TaskEntity,
  userId: string,
) {
  const personalized = { ...state };
  if (state.roleCode === 'dispatcher') {
    if (state.statusKey === 'pending_dispatch')
      personalized.statusLabel = '待我派发';
    else if (task.dispatcher_user_id === userId) {
      personalized.statusLabel = state.statusLabel.replace(
        /^已派发/,
        '我已派发',
      );
    }
  }
  if (state.roleCode === 'executor') {
    if (task.assignee_user_id !== userId && state.result === 'reassigned') {
      personalized.statusKey = 'reassigned';
      personalized.statusLabel = '已被改派';
      personalized.bucket = 'done';
      personalized.actionable = false;
      personalized.availableActions = [];
    } else {
      personalized.statusLabel = personalized.statusLabel
        .replace('待执行人开始', '待我开始')
        .replace('执行中', '我处理中');
    }
  }
  if (
    ['first_reviewer', 'second_reviewer'].includes(state.roleCode) &&
    state.actionable
  ) {
    personalized.statusLabel = personalized.statusLabel
      .replace(/^待一审$/, '待我一审')
      .replace(/^待二审$/, '待我二审')
      .replace(/^待复审/, '待我复审');
  }
  if (
    ['first_reviewer', 'second_reviewer'].includes(state.roleCode) &&
    state.actorUserId === userId
  ) {
    personalized.statusLabel = personalized.statusLabel
      .replace(/^已通过/, '我已通过')
      .replace(/^已退回/, '我已退回');
  }
  return personalized;
}

function actorIdForRole(task: TaskEntity, roleCode: TaskRoleCode) {
  return (
    {
      dispatcher: task.dispatcher_user_id,
      executor: task.assignee_user_id,
      first_reviewer: task.product_reviewer_user_id,
      second_reviewer: task.customer_reviewer_user_id,
      owner: task.reporter_user_id,
    } satisfies Record<TaskRoleCode, string | null>
  )[roleCode];
}

function stepForRole(roleCode: TaskRoleCode) {
  return (
    {
      dispatcher: TaskWorkflowStep.Dispatch,
      executor: TaskWorkflowStep.Execute,
      first_reviewer: TaskWorkflowStep.FirstReview,
      second_reviewer: TaskWorkflowStep.SecondReview,
      owner: TaskWorkflowStep.Execute,
    } satisfies Record<TaskRoleCode, TaskWorkflowStep>
  )[roleCode];
}

function roleLabel(roleCode: TaskRoleCode) {
  return (
    {
      dispatcher: '派发',
      executor: '执行',
      first_reviewer: '一审',
      second_reviewer: '二审',
      owner: '负责人',
    } satisfies Record<TaskRoleCode, string>
  )[roleCode];
}

function globalStatusLabel(task: TaskEntity) {
  if (task.status === TaskStatus.Returned) {
    return task.returned_from_step === TaskWorkflowStep.FirstReview
      ? '一审退回·待修改'
      : '二审退回·待修改';
  }
  const step = deriveTaskWorkflowStep(task);
  if (step === TaskWorkflowStep.FirstReview) return '待一审';
  if (step === TaskWorkflowStep.SecondReview) return '待二审';
  if (step === TaskWorkflowStep.Done) return '已验收';
  if (step === TaskWorkflowStep.Cancelled) return '已取消';
  if (task.status === TaskStatus.Assigned) return '已指派·待开始';
  if (task.status === TaskStatus.InProgress) return '执行中';
  if (task.status === TaskStatus.Blocked) return '任务受阻';
  return step === TaskWorkflowStep.Dispatch ? '待派发' : task.status;
}

function bucketRank(bucket: TaskRoleState['bucket']) {
  return { todo: 0, attention: 1, active: 2, waiting: 3, done: 4 }[bucket];
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}
