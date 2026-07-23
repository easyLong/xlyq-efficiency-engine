import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import pptxgen from 'pptxgenjs';
import { DataSource, In, Repository } from 'typeorm';
import {
  buildAccessProfile,
  normalizeAccessBusinessCategory,
} from '../common/access-control';
import {
  buildAppPublicUrl,
  rebaseAppPublicUrl,
} from '../common/app-public-url';
import { ensureIndex } from '../common/schema-maintenance';
import { ensureWorkflowConfigTables } from '../common/workflow-config-schema';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { FeishuService } from '../integrations/feishu/feishu.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { RequirementEntity } from '../requirements/entities/requirement.entity';
import { UserEntity } from '../users/entities/user.entity';
import { WorkflowConfigsService } from '../workflow-configs/workflow-configs.service';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ExportTaskAssetsPptDto } from './dto/export-task-assets-ppt.dto';
import { ProvisionTaskWorkspaceDto } from './dto/provision-task-workspace.dto';
import { RegisterTaskResultFileDto } from './dto/register-task-result-file.dto';
import { SaveLocalAssetSheetDto } from './dto/save-local-asset-sheet.dto';
import { UploadLocalAssetImageDto } from './dto/upload-local-asset-image.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskDirectoryEntity } from './entities/task-directory.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskResultFileEntity } from './entities/task-result-file.entity';
import { TaskStatusHistoryEntity } from './entities/task-status-history.entity';
import {
  assertTaskStatusTransition,
  TaskReviewStage,
  TaskStatus,
  taskDisplayStatusLabel,
  taskReviewStageLabel,
  taskStatusLabel,
} from './task-status';
import { buildTaskWorkflowSnapshot } from './task-workflow';
import { TaskWorkflowRuntimeService } from './task-workflow-runtime.service';
import {
  reviewStageToWorkflowStep,
  TaskWorkflowStep,
} from './task-workflow-state';

type ExportAssetImage = {
  file: TaskResultFileEntity | null;
  dataUri: string | null;
  error?: string;
};

type ExportAssetQuotationItem = {
  id: string;
  quotation_id: string;
  quotation_no: string | null;
  item_code: string;
  item_name: string;
  unit: string | null;
  unit_price: string;
  sort_order: number | null;
};

type ExportAssetTaskGroup = {
  task: TaskEntity;
  project: ProjectEntity | null;
  customerName: string | null;
  requirement: RequirementEntity | null;
  requirementItem: RequirementItemEntity | null;
  quotationItem: ExportAssetQuotationItem | null;
  assignee: UserEntity | null;
  images: ExportAssetImage[];
};

type ExportAssetQuotationSection = {
  key: string;
  quotationItem: ExportAssetQuotationItem | null;
  pathParts: string[];
  groups: ExportAssetTaskGroup[];
  imageCount: number;
  loadedImageCount: number;
};

type AssetReviewAccess = {
  mode: 'token' | 'session';
  userId: string | null;
};

type TaskReviewFacts = {
  businessCategory: string | null;
  reviewType: string | null;
  customerCode: string | null;
  customerName: string | null;
  businessPlatform: string | null;
};

@Injectable()
export class TasksService implements OnModuleInit {
  private readonly liveAssetSyncTtlMs = 2 * 60 * 1000;
  private readonly liveAssetSyncConcurrency = 5;
  private readonly defaultListLimit = 500;
  private readonly maxLocalImageCount = 80;
  private readonly maxLocalAssetCount = 200;

  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(RequirementItemEntity)
    private readonly requirementItemsRepository: Repository<RequirementItemEntity>,
    @InjectRepository(RequirementEntity)
    private readonly requirementsRepository: Repository<RequirementEntity>,
    @InjectRepository(TaskDirectoryEntity)
    private readonly taskDirectoriesRepository: Repository<TaskDirectoryEntity>,
    @InjectRepository(TaskResultFileEntity)
    private readonly taskResultFilesRepository: Repository<TaskResultFileEntity>,
    @InjectRepository(TaskStatusHistoryEntity)
    private readonly taskStatusHistoriesRepository: Repository<TaskStatusHistoryEntity>,
    @InjectRepository(FeishuSyncLogEntity)
    private readonly feishuSyncLogsRepository: Repository<FeishuSyncLogEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly feishuService: FeishuService,
    private readonly notificationsService: NotificationsService,
    private readonly workflowConfigsService: WorkflowConfigsService,
    private readonly taskWorkflowRuntime: TaskWorkflowRuntimeService,
  ) {}

  async onModuleInit() {
    await this.ensureTasksSchema();
    await this.ensureTaskStatusHistoryTable();
    await this.ensureTaskReviewTables();
    await this.taskWorkflowRuntime.ensureSchema();
    await this.taskWorkflowRuntime.normalizeLegacyTaskState();
    await this.taskWorkflowRuntime.reconcileOpenWorkItems();
  }

  async findAll(
    projectId?: string,
    assigneeUserId?: string,
    currentUser?: UserEntity | null,
  ) {
    const where = {
      ...(projectId ? { project_id: projectId } : {}),
      ...(assigneeUserId ? { assignee_user_id: assigneeUserId } : {}),
    };

    const tasks = await this.tasksRepository.find({
      where,
      order: { created_at: 'DESC' },
      take: this.defaultListLimit,
    });
    const scoped = await this.scopeTasksForUser(tasks, currentUser ?? null);
    return this.taskWorkflowRuntime.decorateTasks(scoped, currentUser ?? null);
  }

  async findOne(id: string) {
    const task = await this.tasksRepository.findOne({ where: { id } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  async findOneForUser(id: string, actingUserId: string | null) {
    const task = await this.findOne(id);
    await this.assertCanViewTaskAssets(task, actingUserId);
    const currentUser = actingUserId
      ? await this.usersRepository.findOne({ where: { id: actingUserId } })
      : null;
    return (
      await this.taskWorkflowRuntime.decorateTasks([task], currentUser)
    )[0];
  }

  async listStatusHistory(id: string, actingUserId: string | null) {
    const task = await this.findOne(id);
    await this.assertCanViewTaskAssets(task, actingUserId);
    return this.taskStatusHistoriesRepository.find({
      where: { task_id: id },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async getWorkflow(id: string, actingUserId: string | null) {
    const task = await this.findOne(id);
    await this.assertCanViewTaskAssets(task, actingUserId);
    const [workspace, assetCount, statusHistory] = await Promise.all([
      this.taskDirectoriesRepository.findOne({ where: { task_id: id } }),
      this.countAssetsByTaskIds([id]).then((counts) => counts.get(id) ?? 0),
      this.taskStatusHistoriesRepository.find({
        where: { task_id: id },
        order: { created_at: 'DESC' },
        take: 10,
      }),
    ]);

    const currentUser = actingUserId
      ? await this.usersRepository.findOne({ where: { id: actingUserId } })
      : null;
    const workflowView = (
      await this.taskWorkflowRuntime.decorateTasks([task], currentUser)
    )[0]?.workflow_view;

    return {
      task,
      workflow: buildTaskWorkflowSnapshot(task),
      workflowView,
      workspace: workspace
        ? {
            ...workspace,
            access_mode:
              task.assignee_user_id === actingUserId ? 'edit' : 'read_only',
            directory_url:
              task.assignee_user_id === actingUserId
                ? this.ensureSignedLocalAssetSheetUrl(
                    task,
                    workspace.directory_url,
                  )
                : `/asset-review.html?taskId=${encodeURIComponent(task.id)}`,
          }
        : null,
      assetCount,
      statusHistory,
    };
  }

  async board(
    projectId?: string,
    liveAssetCount = false,
    customerId?: string,
    currentUser?: UserEntity | null,
  ) {
    const tasks = await this.findBoardTasks(projectId, customerId, currentUser);
    const assetCountByTaskId = await this.countAssetsByTaskIds(
      tasks.map((task) => task.id),
    );
    if (liveAssetCount) {
      await this.refreshOnlineAssetCounts(tasks, assetCountByTaskId);
    }
    const decoratedTasks = await this.taskWorkflowRuntime.decorateTasks(
      tasks,
      currentUser ?? null,
    );
    const rows = decoratedTasks.map((task) => ({
      ...task,
      asset_count: assetCountByTaskId.get(task.id) ?? 0,
      workflow: buildTaskWorkflowSnapshot(task),
    }));

    return {
      todo: rows.filter((task) =>
        [TaskStatus.Todo, TaskStatus.Pending, TaskStatus.Assigned].includes(
          task.status as TaskStatus,
        ),
      ),
      in_progress: rows.filter((task) => task.status === TaskStatus.InProgress),
      blocked: rows.filter((task) => task.status === TaskStatus.Blocked),
      pending_review: rows.filter(
        (task) => task.status === TaskStatus.PendingReview,
      ),
      completed: rows.filter((task) => task.status === TaskStatus.Completed),
    };
  }

  private async findBoardTasks(
    projectId?: string,
    customerId?: string,
    currentUser?: UserEntity | null,
  ) {
    if (!customerId) {
      const tasks = await this.tasksRepository.find({
        where: projectId ? { project_id: projectId } : {},
        order: { created_at: 'DESC' },
        take: this.defaultListLimit,
      });
      return this.scopeTasksForUser(tasks, currentUser ?? null);
    }

    const projects = await this.projectsRepository.find({
      select: { id: true },
      where: {
        customer_code: customerId,
        ...(projectId ? { id: projectId } : {}),
      },
    });
    const projectIds = projects.map((project) => project.id);
    if (projectIds.length === 0) {
      return [];
    }

    const tasks = await this.tasksRepository.find({
      where: { project_id: In(projectIds) },
      order: { created_at: 'DESC' },
      take: this.defaultListLimit,
    });
    return this.scopeTasksForUser(tasks, currentUser ?? null);
  }

  private async scopeTasksForUser(
    tasks: TaskEntity[],
    currentUser: UserEntity | null,
  ) {
    if (!currentUser || tasks.length === 0) {
      return tasks;
    }
    const profile = await buildAccessProfile(this.dataSource, currentUser);
    if (profile.dataScope.tasks === 'all') {
      return tasks;
    }
    const handledTaskIds = await this.taskWorkflowRuntime.findHandledTaskIds(
      currentUser.id,
      tasks.map((task) => task.id),
    );
    if (profile.dataScope.tasks === 'assigned') {
      return tasks.filter(
        (task) =>
          handledTaskIds.has(task.id) ||
          [
            task.assignee_user_id,
            task.dispatcher_user_id,
            task.reporter_user_id,
            task.product_reviewer_user_id,
            task.customer_reviewer_user_id,
          ].includes(currentUser.id),
      );
    }

    const itemIds = tasks
      .map((task) => task.requirement_item_id)
      .filter(Boolean);
    if (!itemIds.length) {
      return tasks.filter(
        (task) =>
          handledTaskIds.has(task.id) ||
          [
            task.assignee_user_id,
            task.dispatcher_user_id,
            task.reporter_user_id,
            task.product_reviewer_user_id,
            task.customer_reviewer_user_id,
          ].includes(currentUser.id),
      );
    }
    const items = await this.requirementItemsRepository.find({
      where: { id: In(itemIds) },
    });
    const requirementIds = items
      .map((item) => item.requirement_id)
      .filter(Boolean);
    const requirements = requirementIds.length
      ? await this.requirementsRepository.find({
          where: { id: In(requirementIds) },
        })
      : [];
    const itemById = new Map(items.map((item) => [item.id, item]));
    const requirementById = new Map(
      requirements.map((requirement) => [requirement.id, requirement]),
    );
    const ownedCategories = new Set(profile.ownedBusinessCategoryCodes);
    const dispatchCustomers = new Set(profile.dispatchCustomerCodes);
    const productReviewTypes = new Set(profile.productReviewTypes);
    const customerReviewCodes = new Set(profile.customerReviewCodes);
    return tasks.filter((task) => {
      if (
        handledTaskIds.has(task.id) ||
        [
          task.assignee_user_id,
          task.dispatcher_user_id,
          task.reporter_user_id,
          task.product_reviewer_user_id,
          task.customer_reviewer_user_id,
        ].includes(currentUser.id)
      ) {
        return true;
      }
      const item = task.requirement_item_id
        ? itemById.get(task.requirement_item_id)
        : null;
      const requirement = item
        ? requirementById.get(item.requirement_id)
        : null;
      const businessCategory = normalizeAccessBusinessCategory(
        requirement?.business_category,
      );
      const customerCode = String(requirement?.customer_code ?? '').trim();
      const isOpenDispatch = [TaskStatus.Todo, TaskStatus.Pending].includes(
        task.status as TaskStatus,
      );
      const isOpenFirstReview =
        task.status === TaskStatus.PendingReview &&
        task.review_stage === TaskReviewStage.ProductReview;
      const isOpenSecondReview =
        task.status === TaskStatus.PendingReview &&
        (task.review_stage === TaskReviewStage.CustomerReview ||
          !task.review_stage ||
          task.review_stage === TaskReviewStage.None);
      return (
        ownedCategories.has(businessCategory) ||
        (isOpenDispatch &&
          !task.dispatcher_user_id &&
          dispatchCustomers.has(customerCode)) ||
        (isOpenFirstReview && productReviewTypes.has(businessCategory)) ||
        (isOpenSecondReview && customerReviewCodes.has(customerCode))
      );
    });
  }

  private async refreshOnlineAssetCounts(
    tasks: TaskEntity[],
    assetCountByTaskId: Map<string, number>,
  ) {
    if (tasks.length === 0) {
      return;
    }

    const workspaces = await this.taskDirectoriesRepository.find({
      where: { task_id: In(tasks.map((task) => task.id)) },
    });
    const workspaceByTaskId = new Map(
      workspaces.map((workspace) => [workspace.task_id, workspace]),
    );

    const syncableTasks = tasks.filter((task) => {
      const workspace = workspaceByTaskId.get(task.id);
      return (
        ![TaskStatus.PendingReview, TaskStatus.Completed].includes(
          task.status as TaskStatus,
        ) &&
        workspace?.permission_status === 'sheet_ready' &&
        Boolean(workspace.feishu_folder_token) &&
        !this.isRecentlySynced(workspace.last_synced_at)
      );
    });

    for (const batch of this.chunkArray(
      syncableTasks,
      this.liveAssetSyncConcurrency,
    )) {
      await Promise.all(
        batch.map(async (task) => {
          const workspace = workspaceByTaskId.get(task.id);
          try {
            const result = await this.syncAssetSheet(task.id);
            if (!result.skipped) {
              assetCountByTaskId.set(task.id, result.assetCount ?? 0);
            }
          } catch {
            // Keep the cached DB count if Feishu is temporarily unavailable.
          }
        }),
      );
    }
  }

  private isRecentlySynced(lastSyncedAt: Date | null) {
    if (!lastSyncedAt) {
      return false;
    }
    return Date.now() - lastSyncedAt.getTime() < this.liveAssetSyncTtlMs;
  }

  private chunkArray<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private async countAssetsByTaskIds(taskIds: string[]) {
    if (taskIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.taskResultFilesRepository
      .createQueryBuilder('file')
      .select('file.task_id', 'taskId')
      .addSelect('COUNT(DISTINCT file.file_url)', 'assetCount')
      .where('file.task_id IN (:...taskIds)', { taskIds })
      .andWhere('file.deleted_at IS NULL')
      .andWhere('file.source IN (:...billableSources)', {
        billableSources: this.billableAssetSources(),
      })
      .groupBy('file.task_id')
      .getRawMany<{ taskId: string; assetCount: string }>();

    return new Map(rows.map((row) => [row.taskId, Number(row.assetCount)]));
  }

  async create(dto: CreateTaskDto) {
    const task = this.tasksRepository.create({
      id: randomUUID(),
      project_id: dto.projectId,
      requirement_item_id: dto.requirementItemId ?? null,
      task_no: await this.nextTaskNo(dto.projectId),
      task_name: dto.taskName,
      description: dto.description ?? null,
      status: TaskStatus.Todo,
      review_stage: TaskReviewStage.None,
      current_step: TaskWorkflowStep.Dispatch,
      delivery_version: 0,
      returned_from_step: null,
      workflow_version: 0,
      last_transition_at: new Date(),
      priority: this.normalizePriority(dto.priority),
      urgency_level: dto.urgencyLevel ?? null,
      assignee_user_id: null,
      estimated_hours: dto.estimatedHours ?? null,
      planned_start_at: dto.plannedStartAt
        ? new Date(dto.plannedStartAt)
        : null,
      planned_end_at: dto.plannedEndAt ? new Date(dto.plannedEndAt) : null,
      reporter_user_id: null,
      dispatcher_user_id: null,
      product_review_type: null,
      product_reviewer_user_id: null,
      customer_reviewer_user_id: null,
      blocked_reason: null,
      progress_percent: 0,
    });

    const saved = await this.tasksRepository.save(task);
    await this.taskWorkflowRuntime.syncTaskCurrentStep(saved);
    return saved;
  }

  private async nextTaskNo(projectId: string) {
    const rows = await this.tasksRepository
      .createQueryBuilder('task')
      .withDeleted()
      .select('task.task_no', 'taskNo')
      .where('task.project_id = :projectId', { projectId })
      .getRawMany<{ taskNo: string }>();
    const maxNo = rows.reduce((max, row) => {
      const match = /^TASK-(\d+)$/.exec(row.taskNo ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `TASK-${String(maxNo + 1).padStart(4, '0')}`;
  }

  async createFromRequirementItem(itemId: string) {
    const item = await this.requirementItemsRepository.findOne({
      where: { id: itemId },
    });
    if (!item) {
      throw new NotFoundException('Requirement item not found');
    }

    const projectRow = await this.requirementItemsRepository
      .createQueryBuilder('ri')
      .innerJoin('requirements', 'r', 'ri.requirement_id = r.id')
      .select('r.project_id', 'projectId')
      .where('ri.id = :itemId', { itemId })
      .getRawOne<{ projectId: string }>();

    if (!projectRow?.projectId) {
      throw new NotFoundException('Project for requirement item not found');
    }

    return this.create({
      projectId: projectRow.projectId,
      requirementItemId: item.id,
      taskName: item.item_title,
      description: item.item_description ?? undefined,
      priority: item.priority ?? undefined,
      urgencyLevel: item.urgency_level ?? undefined,
      estimatedHours: item.estimated_hours ?? undefined,
    });
  }

  async update(id: string, dto: UpdateTaskDto, actingUserId?: string | null) {
    const task = await this.findOne(id);
    if (actingUserId !== undefined) {
      await this.assertCanAssignTask(task, actingUserId);
    }
    Object.assign(task, {
      task_name: dto.taskName ?? task.task_name,
      description: dto.description ?? task.description,
      priority:
        dto.priority !== undefined
          ? this.normalizePriority(dto.priority)
          : task.priority,
      urgency_level: dto.urgencyLevel ?? task.urgency_level,
      planned_start_at: dto.plannedStartAt
        ? new Date(dto.plannedStartAt)
        : task.planned_start_at,
      planned_end_at: dto.plannedEndAt
        ? new Date(dto.plannedEndAt)
        : task.planned_end_at,
      estimated_hours: dto.estimatedHours ?? task.estimated_hours,
    });
    return this.tasksRepository.save(task);
  }

  async assign(
    id: string,
    dto: AssignTaskDto,
    dispatcherUserId?: string | null,
  ) {
    const current = await this.findOne(id);
    const hadAssignee = Boolean(current.assignee_user_id);
    const dispatcherId = dispatcherUserId ?? null;
    await this.assertCanAssignTask(current, dispatcherId);
    if (
      [TaskStatus.PendingReview, TaskStatus.Completed].includes(
        current.status as TaskStatus,
      )
    ) {
      throw new BadRequestException('审核中或已完成的任务不能改派');
    }
    const shouldMarkAssigned = [
      TaskStatus.Todo,
      TaskStatus.Pending,
      TaskStatus.Returned,
    ].includes(current.status as TaskStatus);
    const fromStatus = current.status;
    const nextStatus = shouldMarkAssigned
      ? assertTaskStatusTransition(current.status, TaskStatus.Assigned)
      : current.status;
    const claim = await this.dataSource.query(
      `
        UPDATE tasks
        SET dispatcher_user_id = COALESCE(dispatcher_user_id, ?),
            assignee_user_id = ?,
            status = ?,
            review_stage = 'none',
            current_step = 'execute',
            returned_from_step = NULL,
            workflow_version = COALESCE(workflow_version, 0) + 1,
            last_transition_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL
          AND status = ?
          AND (dispatcher_user_id IS NULL OR dispatcher_user_id = ?)
      `,
      [
        dispatcherId,
        dto.assigneeUserId,
        nextStatus,
        current.id,
        current.status,
        dispatcherId,
      ],
    );
    this.assertAssignmentClaimWon(claim);
    const task = await this.findOne(id);
    await this.recordTaskStatusHistory(
      task,
      fromStatus,
      task.status,
      hadAssignee ? 'task_reassigned' : 'task_assigned',
      null,
    );
    if (hadAssignee) {
      await this.taskWorkflowRuntime.completeStep(
        task.id,
        TaskWorkflowStep.Execute,
        current.assignee_user_id,
        'reassigned',
        `改派给 ${dto.assigneeUserId}`,
      );
    } else {
      await this.taskWorkflowRuntime.completeStep(
        task.id,
        TaskWorkflowStep.Dispatch,
        dispatcherId,
        'assigned',
      );
    }
    await this.taskWorkflowRuntime.syncTaskCurrentStep(task, {
      forceNew: hadAssignee,
    });
    if (!dto.provisionWorkspace) {
      const notification =
        await this.notificationsService.notifyTaskAssigned(task);
      return {
        task,
        notification,
      };
    }

    const workspaceResult = await this.provisionWorkspace(id, {
      assigneeUserId: dto.assigneeUserId,
      feishuFolderToken: dto.feishuFolderToken,
      directoryUrl: dto.directoryUrl,
    });

    return {
      task,
      workspace: workspaceResult.workspace,
      assignmentNotification: null,
      workspaceNotification: workspaceResult.notification,
    };
  }

  async aiAssignmentSuggestion(id: string) {
    const task = await this.findOne(id);
    const fallbackAssignee = await this.tasksRepository
      .createQueryBuilder('t')
      .select('t.assignee_user_id', 'assigneeUserId')
      .addSelect('COUNT(*)', 'taskCount')
      .where('t.assignee_user_id IS NOT NULL')
      .groupBy('t.assignee_user_id')
      .orderBy('COUNT(*)', 'ASC')
      .limit(1)
      .getRawOne<{ assigneeUserId: string | null; taskCount: string }>();

    return {
      taskId: task.id,
      currentAssigneeUserId: task.assignee_user_id,
      suggestion: {
        assigneeUserId: fallbackAssignee?.assigneeUserId ?? null,
        reason:
          '基于当前数据量，先按最低已分配任务数给出一个简单建议，后续可替换为真实 AI 评分模型。',
        matchScore: fallbackAssignee?.assigneeUserId ? 72 : 0,
      },
    };
  }

  async getWorkspace(id: string, actingUserId: string | null) {
    const task = await this.findOne(id);
    await this.assertCanViewTaskAssets(task, actingUserId);
    const workspace = await this.taskDirectoriesRepository.findOne({
      where: { task_id: id },
    });
    if (!workspace) {
      return null;
    }
    const canEdit = task.assignee_user_id === actingUserId;
    return {
      ...workspace,
      access_mode: canEdit ? 'edit' : 'read_only',
      directory_url: canEdit
        ? this.ensureSignedLocalAssetSheetUrl(task, workspace.directory_url)
        : `/asset-review.html?taskId=${encodeURIComponent(task.id)}`,
    };
  }

  async getAssetSheetContext(id: string, token?: string) {
    const task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    const [project, requirementItem, assignee, workspace, files] =
      await Promise.all([
        this.projectsRepository.findOne({ where: { id: task.project_id } }),
        task.requirement_item_id
          ? this.requirementItemsRepository.findOne({
              where: { id: task.requirement_item_id },
            })
          : Promise.resolve(null),
        task.assignee_user_id
          ? this.usersRepository.findOne({
              where: { id: task.assignee_user_id },
            })
          : Promise.resolve(null),
        this.taskDirectoriesRepository.findOne({ where: { task_id: id } }),
        this.listResultFiles(id),
      ]);
    const requirement = requirementItem
      ? await this.requirementsRepository.findOne({
          where: { id: requirementItem.requirement_id },
        })
      : null;

    const localImages = files.filter(
      (file) => file.source === 'local_asset_sheet_image',
    );
    const localLinks = files.filter(
      (file) => file.source === 'local_asset_sheet_link',
    );
    const legacyLocalAssets = files.filter(
      (file) => file.source === 'local_asset_sheet',
    );

    return {
      task,
      project,
      requirement,
      requirementItem,
      assignee: assignee
        ? {
            id: assignee.id,
            username: assignee.username,
            display_name: assignee.display_name,
            avatar_url: assignee.avatar_url,
          }
        : null,
      workspace,
      files,
      workflow: buildTaskWorkflowSnapshot(task),
      assigneeSession: await this.publicAssigneeSession(task),
      delivery: {
        imageUrls: (localImages.length ? localImages : legacyLocalAssets).map(
          (file) => file.file_url,
        ),
        linkUrl: localLinks[0]?.file_url ?? '',
        linkUrls: localLinks.map((file) => file.file_url),
      },
    };
  }

  async startAssetSheetWork(id: string, token?: string) {
    const task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    if (!task.assignee_user_id) {
      throw new BadRequestException('任务尚未指派执行人');
    }
    if (task.status === TaskStatus.PendingReview) {
      throw new BadRequestException('任务正在审核中，暂不能重新开始');
    }
    if (task.status === TaskStatus.Completed) {
      throw new BadRequestException('任务已完成，如需返工请由管理者发起');
    }
    if (
      [TaskStatus.InProgress, TaskStatus.Returned].includes(
        task.status as TaskStatus,
      )
    ) {
      await this.taskWorkflowRuntime.claimStep(
        task.id,
        TaskWorkflowStep.Execute,
        task.assignee_user_id,
      );
      return {
        task,
        statusLabel: taskDisplayStatusLabel(
          task.status,
          task.review_stage,
          task.blocked_reason,
        ),
        workflow: buildTaskWorkflowSnapshot(task),
      };
    }

    const fromStatus = task.status;
    task.status = assertTaskStatusTransition(
      task.status,
      TaskStatus.InProgress,
    );
    task.progress_percent = Math.max(Number(task.progress_percent ?? 0), 30);
    task.actual_end_at = null;
    task.current_step = TaskWorkflowStep.Execute;
    task.returned_from_step = null;
    task.workflow_version = Number(task.workflow_version ?? 0) + 1;
    task.last_transition_at = new Date();
    const saved = await this.tasksRepository.save(task);
    await this.taskWorkflowRuntime.claimStep(
      saved.id,
      TaskWorkflowStep.Execute,
      saved.assignee_user_id!,
    );
    await this.recordTaskStatusHistory(
      saved,
      fromStatus,
      saved.status,
      'asset_sheet_started',
      null,
    );
    return {
      task: saved,
      statusLabel: taskDisplayStatusLabel(
        saved.status,
        saved.review_stage,
        saved.blocked_reason,
      ),
      workflow: buildTaskWorkflowSnapshot(saved),
    };
  }

  async getProgressFeedbackContext(id: string, token?: string) {
    const task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    const [project, requirementItem, assignee, workspace] = await Promise.all([
      this.projectsRepository.findOne({ where: { id: task.project_id } }),
      task.requirement_item_id
        ? this.requirementItemsRepository.findOne({
            where: { id: task.requirement_item_id },
          })
        : Promise.resolve(null),
      task.assignee_user_id
        ? this.usersRepository.findOne({ where: { id: task.assignee_user_id } })
        : Promise.resolve(null),
      this.taskDirectoriesRepository.findOne({ where: { task_id: id } }),
    ]);
    const fundPlatformLabel = await this.taskFundPlatformLabel(task, project);

    return {
      task,
      project,
      fundPlatformLabel,
      requirementItem,
      assignee: assignee
        ? {
            id: assignee.id,
            username: assignee.username,
            display_name: assignee.display_name,
            avatar_url: assignee.avatar_url,
          }
        : null,
      workspace,
      statusLabel: this.publicTaskStatusLabel(task),
      workflow: buildTaskWorkflowSnapshot(task),
      assigneeSession: await this.publicAssigneeSession(task),
      assetSheetUrl: workspace?.directory_url
        ? this.ensureSignedLocalAssetSheetUrl(task, workspace.directory_url)
        : this.buildLocalAssetSheetUrl(task),
    };
  }

  async provisionWorkspace(
    id: string,
    dto: ProvisionTaskWorkspaceDto,
    actingUserId?: string | null,
  ) {
    const task = await this.findOne(id);
    if (actingUserId !== undefined) {
      await this.assertCanAssignTask(task, actingUserId);
    }
    const assigneeUserId = task.assignee_user_id;
    if (!assigneeUserId) {
      throw new BadRequestException(
        'Task must have an assignee before provisioning workspace permission',
      );
    }
    if (dto.assigneeUserId && dto.assigneeUserId !== assigneeUserId) {
      throw new BadRequestException(
        '资产目录执行人必须与任务执行人一致，请先使用改派功能',
      );
    }

    const assetSheet = await this.prepareAssetSheet(task, dto);
    let workspace = await this.taskDirectoriesRepository.findOne({
      where: { task_id: id },
    });

    if (!workspace) {
      workspace = this.taskDirectoriesRepository.create({
        id: randomUUID(),
        task_id: task.id,
        project_id: task.project_id,
        assignee_user_id: assigneeUserId,
        feishu_folder_token:
          assetSheet.spreadsheetToken ?? dto.feishuFolderToken ?? null,
        directory_url: assetSheet.url,
        permission_status: 'pending_sync',
        last_synced_at: null,
      });
    } else {
      Object.assign(workspace, {
        assignee_user_id: assigneeUserId,
        feishu_folder_token:
          assetSheet.spreadsheetToken ??
          dto.feishuFolderToken ??
          workspace.feishu_folder_token,
        directory_url: assetSheet.url ?? workspace.directory_url,
      });
    }

    workspace.permission_status =
      assetSheet.source === 'feishu_sheet'
        ? 'sheet_ready'
        : 'local_sheet_ready';
    workspace.last_synced_at =
      assetSheet.source === 'feishu_sheet' ? null : new Date();
    const saved = await this.taskDirectoriesRepository.save(workspace);

    await this.feishuSyncLogsRepository.save(
      this.feishuSyncLogsRepository.create({
        object_type: 'task',
        object_id: task.id,
        action_type: 'grant_folder_permission',
        feishu_object_type: assetSheet.source,
        feishu_object_id: saved.feishu_folder_token,
        request_payload_json: {
          taskId: task.id,
          assigneeUserId,
          assetSheetUrl: saved.directory_url,
          columns: ['编号', '资产地址', '图片地址（可多张）', '交付链接'],
          autoNumberFrom: 1,
        },
        response_payload_json: {
          mocked: assetSheet.source === 'local_asset_sheet',
          permissionStatus: saved.permission_status,
          assetSheet,
        },
        status: assetSheet.source === 'feishu_sheet' ? 'success' : 'mock_sent',
        error_code: null,
        error_message: null,
        triggered_at: new Date(),
        finished_at: new Date(),
      }),
    );

    const notification =
      await this.notificationsService.notifyTaskWorkspaceProvisioned(
        task,
        saved,
      );

    return {
      workspace: saved,
      notification,
    };
  }

  private async prepareAssetSheet(
    task: TaskEntity,
    dto: ProvisionTaskWorkspaceDto,
  ) {
    const fallbackUrl = dto.directoryUrl?.includes('/drive/folder/')
      ? this.buildLocalAssetSheetUrl(task)
      : (dto.directoryUrl ?? this.buildLocalAssetSheetUrl(task));
    try {
      const spreadsheet = await this.feishuService.createTaskAssetSpreadsheet({
        title: `${task.task_no} 资产登记表`,
        objectId: task.id,
        folderToken: dto.feishuFolderToken,
      });
      await this.feishuService.grantSpreadsheetEditPermission({
        spreadsheetToken: spreadsheet.spreadsheetToken,
        userId: dto.assigneeUserId ?? task.assignee_user_id!,
        objectId: task.id,
      });
      return {
        source: 'feishu_sheet',
        url: spreadsheet.spreadsheetUrl,
        spreadsheetToken: spreadsheet.spreadsheetToken,
        sheetId: spreadsheet.sheetId,
      };
    } catch (error) {
      return {
        source: 'local_asset_sheet',
        url: fallbackUrl,
        spreadsheetToken: null,
        sheetId: null,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildLocalAssetSheetUrl(task: TaskEntity) {
    const token = this.assetSheetToken(task);
    return buildAppPublicUrl('/asset-sheet.html', {
      taskId: task.id,
      taskNo: task.task_no,
      token,
    });
  }

  private ensureSignedLocalAssetSheetUrl(task: TaskEntity, url: string | null) {
    if (!url || !url.includes('/asset-sheet.html')) {
      return url;
    }
    try {
      const parsed = new URL(rebaseAppPublicUrl(url));
      parsed.searchParams.set('taskId', task.id);
      parsed.searchParams.set('taskNo', task.task_no);
      parsed.searchParams.set('token', this.assetSheetToken(task));
      return parsed.toString();
    } catch {
      return this.buildLocalAssetSheetUrl(task);
    }
  }

  async syncAssetSheet(id: string) {
    const task = await this.findOne(id);
    const workspace = await this.taskDirectoriesRepository.findOne({
      where: { task_id: id },
    });
    if (!workspace) {
      throw new NotFoundException('Task asset sheet not found');
    }
    if (
      [TaskStatus.PendingReview, TaskStatus.Completed].includes(
        task.status as TaskStatus,
      )
    ) {
      return {
        task,
        workspace,
        syncedCount: 0,
        skipped: true,
        reason: '审核中或已完成的任务已锁定交付快照。',
      };
    }
    if (
      workspace.permission_status !== 'sheet_ready' ||
      !workspace.feishu_folder_token
    ) {
      return {
        task,
        workspace,
        syncedCount: 0,
        skipped: true,
        reason:
          '任务当前使用本地资产表或飞书表格未就绪，无法由服务端读取飞书表格。',
      };
    }

    const assets = this.uniqueAssets(
      await this.feishuService.readAssetSheetRows({
        spreadsheetToken: workspace.feishu_folder_token,
        objectId: task.id,
      }),
    );
    await this.taskResultFilesRepository.softDelete({
      task_id: task.id,
      source: In([
        'feishu_asset_sheet',
        'feishu_asset_sheet_image',
        'feishu_asset_sheet_link',
      ]),
    });
    const created: TaskResultFileEntity[] = [];

    for (const asset of assets) {
      if (asset.assetUrl) {
        created.push(
          await this.createTaskResultFile(task, {
            fileName: `资产-${asset.sequence}`,
            fileUrl: asset.assetUrl,
            source: 'feishu_asset_sheet',
            remark: `来自资产登记表第 ${asset.sequence} 行`,
          }),
        );
      }
      for (const [imageIndex, imageUrl] of (asset.imageUrls ?? []).entries()) {
        created.push(
          await this.createTaskResultFile(task, {
            fileName: `图片-${asset.sequence}-${imageIndex + 1}`,
            fileUrl: imageUrl,
            source: 'feishu_asset_sheet_image',
            remark: `来自资产登记表第 ${asset.sequence} 行图片区`,
          }),
        );
      }
      if (asset.linkUrl) {
        created.push(
          await this.createTaskResultFile(task, {
            fileName: `交付链接-${asset.sequence}`,
            fileUrl: asset.linkUrl,
            source: 'feishu_asset_sheet_link',
            remark: `来自资产登记表第 ${asset.sequence} 行单链接区`,
          }),
        );
      }
    }
    const savedTask = await this.markTaskPendingReviewIfAssetsSubmitted(
      task,
      this.billableAssetCount(created),
    );
    workspace.last_synced_at = new Date();
    const savedWorkspace = await this.taskDirectoriesRepository.save(workspace);
    const assetCount = this.billableAssetCount(created);
    const reviewNotification =
      savedTask.status === TaskStatus.PendingReview && assetCount > 0
        ? await this.notifyProductReviewers(savedTask, assetCount)
        : null;

    return {
      task: savedTask,
      workflow: buildTaskWorkflowSnapshot(savedTask),
      workspace: savedWorkspace,
      assetCount,
      syncedCount: created.length,
      created,
      reviewNotification,
    };
  }

  async saveLocalAssetSheet(
    id: string,
    dto: SaveLocalAssetSheetDto,
    token?: string,
  ) {
    const task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    this.assertTaskCanSubmitDelivery(task);
    const assetUrls = this.uniqueTextValues(
      new Set(
        (dto.assets ?? [])
          .map((asset) => asset.assetUrl.trim())
          .filter((assetUrl) => assetUrl.length > 0),
      ),
    );
    const imageUrls = this.uniqueTextValues(dto.imageUrls ?? []);
    const linkUrls = this.uniqueTextValues([
      ...(dto.linkUrls ?? []),
      dto.linkUrl ?? '',
    ]);
    this.assertDeliveryUrls(assetUrls, imageUrls, linkUrls);
    if (!assetUrls.length && !imageUrls.length && !linkUrls.length) {
      throw new BadRequestException(
        '请至少上传一张图片或填写一个交付链接后再提交交付',
      );
    }

    const productReviewType = await this.resolveTaskProductReviewType(task);
    const { created, savedTask, fromStatus, fromReviewStage } =
      await this.dataSource.transaction(async (manager) => {
        const fileRepository = manager.getRepository(TaskResultFileEntity);
        const taskRepository = manager.getRepository(TaskEntity);
        const lockedTask = await taskRepository.findOne({
          where: { id: task.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedTask) {
          throw new NotFoundException(`Task ${task.id} not found`);
        }
        this.assertTaskCanSubmitDelivery(lockedTask);
        const fromStatus = lockedTask.status;
        const fromReviewStage = lockedTask.review_stage ?? TaskReviewStage.None;
        await fileRepository.softDelete({
          task_id: lockedTask.id,
          source: In([
            'local_asset_sheet',
            'local_asset_sheet_image',
            'local_asset_sheet_link',
          ]),
        });

        const created: TaskResultFileEntity[] = [];
        const createFile = async (input: {
          fileName: string;
          fileUrl: string;
          source: string;
          remark: string;
        }) => {
          const file = fileRepository.create({
            id: randomUUID(),
            task_id: lockedTask.id,
            project_id: lockedTask.project_id,
            file_name: input.fileName,
            file_url: input.fileUrl,
            feishu_file_token: null,
            uploaded_by_user_id: lockedTask.assignee_user_id,
            source: input.source,
            remark: input.remark,
          });
          created.push(await fileRepository.save(file));
        };

        for (const [index, assetUrl] of assetUrls.entries()) {
          await createFile({
            fileName: `资产-${index + 1}`,
            fileUrl: assetUrl,
            source: 'local_asset_sheet',
            remark: `来自本地兜底资产表第 ${index + 1} 行`,
          });
        }
        for (const [index, imageUrl] of imageUrls.entries()) {
          await createFile({
            fileName: `图片-${index + 1}`,
            fileUrl: imageUrl,
            source: 'local_asset_sheet_image',
            remark: `来自本地任务通知页图片区第 ${index + 1} 张`,
          });
        }
        for (const [index, linkUrl] of linkUrls.entries()) {
          await createFile({
            fileName:
              linkUrls.length > 1 ? `合作链接-${index + 1}` : '合作链接',
            fileUrl: linkUrl,
            source: 'local_asset_sheet_link',
            remark: `来自本地任务通知页合作链接区第 ${index + 1} 条`,
          });
        }

        lockedTask.status = assertTaskStatusTransition(
          lockedTask.status,
          TaskStatus.PendingReview,
        );
        lockedTask.review_stage = TaskReviewStage.ProductReview;
        lockedTask.current_step = TaskWorkflowStep.FirstReview;
        lockedTask.delivery_version =
          Number(lockedTask.delivery_version ?? 0) + 1;
        lockedTask.returned_from_step = null;
        lockedTask.workflow_version =
          Number(lockedTask.workflow_version ?? 0) + 1;
        lockedTask.last_transition_at = new Date();
        lockedTask.product_review_type = productReviewType;
        lockedTask.product_reviewer_user_id = null;
        lockedTask.customer_reviewer_user_id = null;
        lockedTask.progress_percent = Math.max(
          Number(lockedTask.progress_percent ?? 0),
          90,
        );
        lockedTask.blocked_reason = null;
        lockedTask.actual_end_at = null;
        const savedTask = await taskRepository.save(lockedTask);
        await this.taskWorkflowRuntime.completeStep(
          savedTask.id,
          TaskWorkflowStep.Execute,
          savedTask.assignee_user_id,
          'submitted',
          `提交 V${savedTask.delivery_version}`,
          manager,
        );
        await this.taskWorkflowRuntime.syncTaskCurrentStep(savedTask, {
          manager,
        });
        return { created, savedTask, fromStatus, fromReviewStage };
      });
    await this.recordTaskStatusHistory(
      savedTask,
      fromStatus,
      savedTask.status,
      'local_asset_submitted',
      null,
    );
    const assetCount = this.billableAssetCount(created);
    if (
      savedTask.status === TaskStatus.PendingReview &&
      savedTask.review_stage === TaskReviewStage.ProductReview
    ) {
      await this.recordTaskReview(
        savedTask,
        TaskReviewStage.ProductReview,
        'submitted',
        null,
        fromStatus,
        savedTask.status,
        fromReviewStage,
        savedTask.review_stage,
        null,
      );
    }
    const reviewNotification =
      savedTask.status === TaskStatus.PendingReview && assetCount > 0
        ? await this.notifyProductReviewers(savedTask, assetCount)
        : null;

    return {
      task: savedTask,
      workflow: buildTaskWorkflowSnapshot(savedTask),
      assigneeSession: await this.publicAssigneeSession(savedTask),
      assetCount,
      syncedCount: created.length,
      created,
      reviewNotification,
    };
  }

  async uploadLocalAssetImage(
    id: string,
    dto: UploadLocalAssetImageDto,
    token?: string,
  ) {
    const task = await this.findOne(id);
    this.assertAssetSheetAccess(task, token);
    this.assertTaskCanSubmitDelivery(task);
    await this.assertUploadCapacity(task.id);
    const match =
      /^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/=]+)$/i.exec(
        dto.dataUrl ?? '',
      );
    if (!match) {
      throw new BadRequestException(
        'Only png, jpg, webp or gif images are supported',
      );
    }

    const ext =
      match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length <= 0) {
      throw new BadRequestException('Uploaded image is empty');
    }
    if (bytes.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Uploaded image must be smaller than 8MB');
    }

    const uploadDir = join(
      process.cwd(),
      'public',
      'uploads',
      'task-assets',
      task.id,
    );
    await mkdir(uploadDir, { recursive: true });
    const safeBaseName = this.safeFileBaseName(dto.fileName) || 'image';
    const fileName = `${safeBaseName}-${randomUUID().slice(0, 8)}.${ext}`;
    const filePath = join(uploadDir, fileName);
    await writeFile(filePath, bytes);

    return {
      taskId: task.id,
      imageUrl: `/uploads/task-assets/${task.id}/${fileName}`,
      fileName,
      size: bytes.length,
    };
  }

  private uniqueTextValues(values: string[] | Set<string>) {
    return Array.from(values)
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  private assertDeliveryUrls(
    assetUrls: string[],
    imageUrls: string[],
    linkUrls: string[],
  ) {
    if (assetUrls.length > this.maxLocalAssetCount) {
      throw new BadRequestException(
        `Asset URL count cannot exceed ${this.maxLocalAssetCount}`,
      );
    }
    if (imageUrls.length > this.maxLocalImageCount) {
      throw new BadRequestException(
        `Image URL count cannot exceed ${this.maxLocalImageCount}`,
      );
    }
    const allUrls = [...assetUrls, ...imageUrls, ...linkUrls].filter(Boolean);
    for (const url of allUrls) {
      if (url.length > 500) {
        throw new BadRequestException(
          'Delivery URL cannot exceed 500 characters',
        );
      }
      if (!this.isAllowedDeliveryUrl(url)) {
        throw new BadRequestException(
          'Delivery URL must be http(s) or a local uploads path',
        );
      }
    }
  }

  private isAllowedDeliveryUrl(url: string) {
    return /^https?:\/\//i.test(url) || url.startsWith('/uploads/task-assets/');
  }

  private async assertUploadCapacity(taskId: string) {
    const count = await this.taskResultFilesRepository.count({
      where: {
        task_id: taskId,
        source: In(['local_asset_sheet_image', 'local_asset_sheet']),
      },
    });
    if (count >= this.maxLocalImageCount) {
      throw new BadRequestException(
        `Image asset count cannot exceed ${this.maxLocalImageCount}`,
      );
    }
  }

  private billableAssetSources() {
    return [
      'local_asset_sheet',
      'local_asset_sheet_image',
      'feishu_asset_sheet',
      'feishu_asset_sheet_image',
      'manual',
      'feishu',
    ];
  }

  private billableAssetCount(files: TaskResultFileEntity[]) {
    const sources = new Set(this.billableAssetSources());
    return new Set(
      files
        .filter((file) => sources.has(file.source))
        .map((file) => file.file_url)
        .filter(Boolean),
    ).size;
  }

  private assetSheetToken(task: TaskEntity) {
    const secret =
      process.env.TASK_ACCESS_TOKEN_SECRET ??
      process.env.APP_SECRET ??
      process.env.DB_PASSWORD ??
      'xlyq-efficiency-engine-local-secret';
    return createHmac('sha256', secret)
      .update(`${task.id}:${task.task_no}`)
      .digest('hex');
  }

  private publicTaskStatusLabel(task: TaskEntity) {
    return taskDisplayStatusLabel(
      task.status,
      task.review_stage,
      task.blocked_reason,
    );
  }

  private async publicAssigneeSession(task: TaskEntity) {
    return task.assignee_user_id
      ? this.publicUserSession(task.assignee_user_id)
      : null;
  }

  private async publicUserSession(userId: string) {
    if (!userId) {
      return null;
    }
    const assignee = await this.usersRepository.findOne({
      where: { id: userId, status: 'active' },
    });
    if (!assignee) {
      return null;
    }
    let profile: Awaited<ReturnType<typeof buildAccessProfile>> | null = null;
    try {
      profile = await buildAccessProfile(this.dataSource, assignee);
    } catch {
      profile = null;
    }
    const memberPermissions = [
      'page.requirements',
      'page.messages',
      'task.view_assigned',
      'task.submit_assigned',
    ];
    return {
      accessToken: `mvp-${assignee.id}`,
      tokenType: 'MVP',
      user: {
        id: assignee.id,
        username: assignee.username,
        display_name: assignee.display_name,
        email: assignee.email,
        mobile: assignee.mobile,
        avatar_url: assignee.avatar_url,
        status: assignee.status,
        source: assignee.source,
        feishu_open_id: assignee.feishu_open_id,
        role_codes: profile?.roleCodes ?? [],
        effective_roles: profile?.effectiveRoles ?? ['member'],
        permissions: profile?.permissions ?? memberPermissions,
        data_scope: profile?.dataScope ?? {
          requirements: 'assigned',
          tasks: 'assigned',
          quotes: 'none',
          settlement: 'none',
        },
        owned_business_category_codes:
          profile?.ownedBusinessCategoryCodes ?? [],
        dispatch_customer_codes: profile?.dispatchCustomerCodes ?? [],
        product_review_types: profile?.productReviewTypes ?? [],
        customer_review_codes: profile?.customerReviewCodes ?? [],
        is_admin: profile?.isAdmin ?? false,
      },
    };
  }

  private assertAssetSheetAccess(task: TaskEntity, token?: string) {
    const expected = this.assetSheetToken(task);
    if (!token || token.length !== expected.length) {
      throw new UnauthorizedException('Invalid task access token');
    }
    const ok = timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) {
      throw new UnauthorizedException('Invalid task access token');
    }
  }

  private assertTaskCanSubmitDelivery(task: TaskEntity) {
    if (!task.assignee_user_id) {
      throw new BadRequestException('任务尚未指派执行人');
    }
    if (task.status === TaskStatus.PendingReview) {
      throw new ConflictException('任务正在审核中，请等待审核结果后再操作');
    }
    if (task.status === TaskStatus.Completed) {
      throw new ConflictException('任务已完成，不能再修改交付内容');
    }
    const submittableStatuses = new Set<string>([
      TaskStatus.Todo,
      TaskStatus.Pending,
      TaskStatus.Assigned,
      TaskStatus.InProgress,
      TaskStatus.Blocked,
      TaskStatus.Returned,
    ]);
    if (!submittableStatuses.has(task.status)) {
      throw new BadRequestException(`当前任务状态不能提交交付：${task.status}`);
    }
  }

  private safeFileBaseName(value?: string) {
    const raw = (value ?? '').trim();
    const withoutExt = raw
      ? raw.slice(0, raw.length - extname(raw).length)
      : '';
    return withoutExt
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
  }

  private async createTaskResultFile(
    task: TaskEntity,
    input: {
      fileName: string;
      fileUrl: string;
      source: string;
      remark: string;
    },
  ) {
    const file = this.taskResultFilesRepository.create({
      id: randomUUID(),
      task_id: task.id,
      project_id: task.project_id,
      file_name: input.fileName,
      file_url: input.fileUrl,
      feishu_file_token: null,
      uploaded_by_user_id: task.assignee_user_id,
      source: input.source,
      remark: input.remark,
    });
    return this.taskResultFilesRepository.save(file);
  }

  private async markTaskPendingReviewIfAssetsSubmitted(
    task: TaskEntity,
    assetCount: number,
  ) {
    if (
      assetCount <= 0 ||
      task.status === TaskStatus.PendingReview ||
      task.status === TaskStatus.Completed
    ) {
      return task;
    }

    const fromStatus = task.status;
    const fromReviewStage = task.review_stage ?? TaskReviewStage.None;
    const productReviewType = await this.resolveTaskProductReviewType(task);
    if (task.status !== TaskStatus.PendingReview) {
      task.status = assertTaskStatusTransition(
        task.status,
        TaskStatus.PendingReview,
      );
    }
    task.review_stage = TaskReviewStage.ProductReview;
    task.current_step = TaskWorkflowStep.FirstReview;
    task.delivery_version = Number(task.delivery_version ?? 0) + 1;
    task.returned_from_step = null;
    task.workflow_version = Number(task.workflow_version ?? 0) + 1;
    task.last_transition_at = new Date();
    task.product_review_type = productReviewType;
    task.product_reviewer_user_id = null;
    task.customer_reviewer_user_id = null;
    task.progress_percent = Math.max(Number(task.progress_percent ?? 0), 90);
    task.blocked_reason = null;
    task.actual_end_at = null;
    const saved = await this.tasksRepository.save(task);
    await this.taskWorkflowRuntime.completeStep(
      saved.id,
      TaskWorkflowStep.Execute,
      saved.assignee_user_id,
      'submitted',
      `提交 V${saved.delivery_version}`,
    );
    await this.taskWorkflowRuntime.syncTaskCurrentStep(saved);
    await this.recordTaskStatusHistory(
      saved,
      fromStatus,
      saved.status,
      'asset_submitted',
      null,
    );
    await this.recordTaskReview(
      saved,
      TaskReviewStage.ProductReview,
      'submitted',
      null,
      fromStatus,
      saved.status,
      fromReviewStage,
      saved.review_stage,
      null,
    );
    return saved;
  }

  private normalizePriority(value?: string | null) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    if (normalized === 'high') return 'p0';
    if (normalized === 'medium') return 'p1';
    if (normalized === 'low') return 'p2';
    const match = /^p(\d+)$/.exec(normalized);
    if (match) return `p${Math.min(4, Number(match[1]))}`;
    return 'p3';
  }

  private async taskFundPlatformLabel(
    task: TaskEntity,
    project?: ProjectEntity | null,
  ) {
    const rows = await this.dataSource.query(
      `
        SELECT
          COALESCE(requirement_customer.customer_name, project_customer.customer_name) AS customerName,
          requirement.business_platform AS businessPlatform
        FROM tasks task
        LEFT JOIN requirement_items item ON item.id = task.requirement_item_id
        LEFT JOIN requirements requirement ON requirement.id = item.requirement_id
        LEFT JOIN customers requirement_customer ON requirement_customer.customer_code = requirement.customer_code
        LEFT JOIN projects project ON project.id = task.project_id
        LEFT JOIN customers project_customer ON project_customer.customer_code = project.customer_code
        WHERE task.id = ?
        LIMIT 1
      `,
      [task.id],
    );
    const customerName =
      rows?.[0]?.customerName ?? project?.project_name ?? '未关联基金';
    const businessPlatform = rows?.[0]?.businessPlatform ?? '未关联平台';
    return `${customerName}-${businessPlatform}`;
  }

  private async recordTaskStatusHistory(
    task: TaskEntity,
    fromStatus: string,
    toStatus: string,
    triggerSource: string,
    remark: string | null | undefined,
  ) {
    if (fromStatus === toStatus) {
      return null;
    }
    return this.taskStatusHistoriesRepository.save(
      this.taskStatusHistoriesRepository.create({
        task_id: task.id,
        from_status: fromStatus,
        to_status: toStatus,
        trigger_source: triggerSource,
        remark: remark ?? null,
      }),
    );
  }

  private async recordTaskReview(
    task: TaskEntity,
    reviewStage: string,
    reviewResult: string,
    reviewerUserId: string | null,
    fromStatus: string | null,
    toStatus: string | null,
    fromReviewStage: string | null,
    toReviewStage: string | null,
    reviewComment: string | null,
  ) {
    await this.dataSource.query(
      `
        INSERT INTO task_review_records (
          id,
          task_id,
          review_stage,
          review_result,
          reviewer_user_id,
          from_status,
          to_status,
          from_review_stage,
          to_review_stage,
          review_comment
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        randomUUID(),
        task.id,
        reviewStage,
        reviewResult,
        reviewerUserId,
        fromStatus,
        toStatus,
        fromReviewStage,
        toReviewStage,
        reviewComment,
      ],
    );
  }

  private async ensureTasksSchema() {
    await this.addColumnIfMissing(
      'tasks',
      'planned_start_at',
      'planned_start_at DATETIME NULL AFTER blocked_reason',
    );
    await this.addColumnIfMissing(
      'tasks',
      'urgency_level',
      'urgency_level VARCHAR(32) NULL AFTER priority',
    );
    await this.addColumnIfMissing(
      'tasks',
      'review_stage',
      "review_stage VARCHAR(32) NOT NULL DEFAULT 'none' AFTER status",
    );
    await this.addColumnIfMissing(
      'tasks',
      'current_step',
      "current_step VARCHAR(32) NOT NULL DEFAULT 'dispatch' AFTER review_stage",
    );
    await this.addColumnIfMissing(
      'tasks',
      'delivery_version',
      'delivery_version INT NOT NULL DEFAULT 0 AFTER current_step',
    );
    await this.addColumnIfMissing(
      'tasks',
      'returned_from_step',
      'returned_from_step VARCHAR(32) NULL AFTER delivery_version',
    );
    await this.addColumnIfMissing(
      'tasks',
      'workflow_version',
      'workflow_version INT NOT NULL DEFAULT 0 AFTER returned_from_step',
    );
    await this.addColumnIfMissing(
      'tasks',
      'last_transition_at',
      'last_transition_at DATETIME NULL AFTER workflow_version',
    );
    await this.addColumnIfMissing(
      'tasks',
      'dispatcher_user_id',
      'dispatcher_user_id CHAR(36) NULL AFTER reporter_user_id',
    );
    await this.addColumnIfMissing(
      'tasks',
      'product_reviewer_user_id',
      'product_reviewer_user_id CHAR(36) NULL AFTER dispatcher_user_id',
    );
    await this.addColumnIfMissing(
      'tasks',
      'customer_reviewer_user_id',
      'customer_reviewer_user_id CHAR(36) NULL AFTER product_reviewer_user_id',
    );
    await this.addColumnIfMissing(
      'tasks',
      'product_review_type',
      'product_review_type VARCHAR(32) NULL AFTER review_stage',
    );
    await ensureIndex(this.dataSource, 'tasks', 'idx_tasks_project_created', [
      'project_id',
      'created_at',
    ]);
    await ensureIndex(
      this.dataSource,
      'tasks',
      'idx_tasks_requirement_item_created',
      ['requirement_item_id', 'created_at'],
    );
    await ensureIndex(this.dataSource, 'tasks', 'idx_tasks_assignee_status', [
      'assignee_user_id',
      'status',
    ]);
    await ensureIndex(this.dataSource, 'tasks', 'idx_tasks_status_due', [
      'status',
      'planned_end_at',
    ]);
    await ensureIndex(this.dataSource, 'tasks', 'idx_tasks_project_task_no', [
      'project_id',
      'task_no',
    ]);
    await ensureIndex(this.dataSource, 'tasks', 'idx_tasks_review_stage', [
      'review_stage',
    ]);
    await ensureIndex(this.dataSource, 'tasks', 'idx_tasks_current_step', [
      'current_step',
      'last_transition_at',
    ]);
    await ensureIndex(this.dataSource, 'tasks', 'idx_tasks_dispatcher', [
      'dispatcher_user_id',
    ]);
    await ensureIndex(this.dataSource, 'tasks', 'idx_tasks_product_reviewer', [
      'product_reviewer_user_id',
    ]);
    await ensureIndex(this.dataSource, 'tasks', 'idx_tasks_customer_reviewer', [
      'customer_reviewer_user_id',
    ]);
    await ensureIndex(
      this.dataSource,
      'task_result_files',
      'idx_task_result_files_task_source_deleted',
      ['task_id', 'source', 'deleted_at'],
    );
    await ensureIndex(
      this.dataSource,
      'task_directories',
      'idx_task_directories_task',
      ['task_id'],
    );
  }

  private async addColumnIfMissing(
    tableName: string,
    columnName: string,
    columnDefinition: string,
  ) {
    const rows = await this.dataSource.query(
      `
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
      [tableName, columnName],
    );
    if (Number(rows?.[0]?.count ?? 0) > 0) {
      return;
    }
    await this.dataSource.query(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`,
    );
  }

  private async ensureTaskStatusHistoryTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS task_status_histories (
        id CHAR(36) NOT NULL,
        task_id CHAR(36) NOT NULL,
        from_status VARCHAR(32) NOT NULL,
        to_status VARCHAR(32) NOT NULL,
        trigger_source VARCHAR(64) NOT NULL,
        remark VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_task_status_histories_task_created (task_id, created_at),
        CONSTRAINT fk_task_status_histories_task FOREIGN KEY (task_id) REFERENCES tasks (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务状态历史表'
    `);
  }

  private async ensureTaskReviewTables() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS task_review_records (
        id CHAR(36) NOT NULL,
        task_id CHAR(36) NOT NULL,
        review_stage VARCHAR(32) NOT NULL,
        review_result VARCHAR(32) NOT NULL,
        reviewer_user_id CHAR(36) NULL,
        from_status VARCHAR(32) NULL,
        to_status VARCHAR(32) NULL,
        from_review_stage VARCHAR(32) NULL,
        to_review_stage VARCHAR(32) NULL,
        review_comment VARCHAR(1000) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_task_review_records_task_created (task_id, created_at),
        KEY idx_task_review_records_reviewer (reviewer_user_id),
        KEY idx_task_review_records_stage (review_stage)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务审核记录表'
    `);
    await ensureWorkflowConfigTables(this.dataSource);
    await this.normalizeLegacyReviewStages();
  }

  private async normalizeLegacyReviewStages() {
    await this.dataSource.query(`
      UPDATE tasks
      SET review_stage = 'customer_review',
          updated_at = updated_at
      WHERE deleted_at IS NULL
        AND status = 'pending_review'
        AND (review_stage IS NULL OR review_stage = 'none')
    `);
    await this.dataSource.query(`
      UPDATE tasks
      SET review_stage = 'done',
          updated_at = updated_at
      WHERE deleted_at IS NULL
        AND status = 'completed'
        AND (review_stage IS NULL OR review_stage = 'none')
    `);
    await this.dataSource.query(`
      INSERT INTO task_review_records (
        id,
        task_id,
        review_stage,
        review_result,
        reviewer_user_id,
        from_status,
        to_status,
        from_review_stage,
        to_review_stage,
        review_comment
      )
      SELECT
        UUID(),
        task.id,
        CASE
          WHEN task.status = 'completed' THEN 'done'
          ELSE 'customer_review'
        END,
        'legacy_migrated',
        NULL,
        task.status,
        task.status,
        'none',
        task.review_stage,
        '历史流程迁移：审核人信息未知，保留原业务结果。'
      FROM tasks task
      WHERE task.deleted_at IS NULL
        AND (
          (
            task.status = 'completed'
            AND task.review_stage = 'done'
            AND task.customer_reviewer_user_id IS NULL
          )
          OR (
            task.status = 'pending_review'
            AND task.review_stage = 'customer_review'
            AND task.product_reviewer_user_id IS NULL
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM task_review_records record
          WHERE record.task_id = task.id
            AND record.review_result = 'legacy_migrated'
            AND record.deleted_at IS NULL
        )
    `);
  }

  private uniqueAssets(
    assets: Array<{
      sequence: number;
      assetUrl: string;
      imageUrls?: string[];
      linkUrl?: string;
    }>,
  ) {
    const seen = new Set<string>();
    return assets.filter((asset) => {
      const urls = [
        asset.assetUrl,
        ...(asset.imageUrls ?? []),
        asset.linkUrl,
      ].filter((url): url is string => Boolean(url));
      const uniqueUrls = urls.filter((url) => !seen.has(url));
      uniqueUrls.forEach((url) => seen.add(url));
      asset.imageUrls = (asset.imageUrls ?? []).filter((url) =>
        uniqueUrls.includes(url),
      );
      if (asset.linkUrl && !uniqueUrls.includes(asset.linkUrl)) {
        asset.linkUrl = '';
      }
      if (asset.assetUrl && !uniqueUrls.includes(asset.assetUrl)) {
        asset.assetUrl = '';
      }
      return uniqueUrls.length > 0;
    });
  }

  async exportAssetsPpt(dto: ExportTaskAssetsPptDto) {
    const taskIds = this.parseExportTaskIds(dto.taskIds);
    if (taskIds.length === 0) {
      throw new BadRequestException('请至少选择一个任务后再导出');
    }

    const tasks = await this.tasksRepository.find({
      where: { id: In(taskIds) },
    });
    if (tasks.length === 0) {
      throw new NotFoundException('No tasks found for export');
    }

    const groups = (await this.buildAssetExportGroups(tasks)).filter(
      (group) => group.images.length > 0,
    );
    if (groups.length === 0) {
      throw new BadRequestException('当前筛选范围内没有可导出的图片资产');
    }
    const sections = this.buildAssetQuotationSections(groups);
    const documentTitle = this.assetDocumentTitle(sections);
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'xlyq-efficiency-engine';
    pptx.subject = 'Task delivery asset export';
    pptx.title = documentTitle;
    pptx.company = 'xlyq-efficiency-engine';
    pptx.theme = {
      headFontFace: 'Microsoft YaHei',
      bodyFontFace: 'Microsoft YaHei',
    };

    this.addAssetDocumentSlides(pptx, sections, documentTitle);

    const output = await pptx.write({ outputType: 'nodebuffer' });
    const buffer = Buffer.isBuffer(output)
      ? output
      : Buffer.from(output as ArrayBuffer);
    return {
      fileName: `${this.safeExportFileName(documentTitle)}_${this.dateStamp()}.pptx`,
      buffer,
    };
  }

  private parseExportTaskIds(raw?: string) {
    return this.uniqueTextValues(
      String(raw ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ).slice(0, 200);
  }

  private async buildAssetExportGroups(tasks: TaskEntity[]) {
    const taskIds = tasks.map((task) => task.id);
    const projectIds = this.uniqueTextValues(
      tasks.map((task) => task.project_id).filter(Boolean),
    );
    const requirementItemIds = this.uniqueTextValues(
      tasks
        .map((task) => task.requirement_item_id)
        .filter((id): id is string => Boolean(id)),
    );
    const assigneeIds = this.uniqueTextValues(
      tasks
        .map((task) => task.assignee_user_id)
        .filter((id): id is string => Boolean(id)),
    );

    const [projects, requirementItems, assignees, files] = await Promise.all([
      projectIds.length
        ? this.projectsRepository.find({ where: { id: In(projectIds) } })
        : Promise.resolve([]),
      requirementItemIds.length
        ? this.requirementItemsRepository.find({
            where: { id: In(requirementItemIds) },
          })
        : Promise.resolve([]),
      assigneeIds.length
        ? this.usersRepository.find({ where: { id: In(assigneeIds) } })
        : Promise.resolve([]),
      this.taskResultFilesRepository.find({
        where: { task_id: In(taskIds) },
        order: { created_at: 'ASC' },
      }),
    ]);
    const requirementIds = this.uniqueTextValues(
      requirementItems.map((item) => item.requirement_id),
    );
    const requirements = requirementIds.length
      ? await this.requirementsRepository.find({
          where: { id: In(requirementIds) },
        })
      : [];
    const mappings = requirementItemIds.length
      ? await this.dataSource.query(
          `
            SELECT requirement_item_id, quotation_item_id
            FROM requirement_quotation_mappings
            WHERE requirement_item_id IN (${requirementItemIds
              .map(() => '?')
              .join(',')})
              AND quotation_item_id IS NOT NULL
              AND mapping_status = 'matched'
            ORDER BY updated_at DESC
          `,
          requirementItemIds,
        )
      : [];
    const quotationItemIdByRequirementItemId = new Map<string, string>();
    for (const mapping of mappings) {
      const requirementItemId = String(mapping.requirement_item_id ?? '');
      const quotationItemId = String(mapping.quotation_item_id ?? '');
      if (
        requirementItemId &&
        quotationItemId &&
        !quotationItemIdByRequirementItemId.has(requirementItemId)
      ) {
        quotationItemIdByRequirementItemId.set(
          requirementItemId,
          quotationItemId,
        );
      }
    }
    const quotationItemIds = this.uniqueTextValues([
      ...quotationItemIdByRequirementItemId.values(),
    ]);
    const quotationItems: ExportAssetQuotationItem[] = quotationItemIds.length
      ? await this.dataSource.query(
          `
            SELECT
              item.id,
              item.quotation_id,
              quotation.quotation_no,
              item.item_code,
              item.item_name,
              item.unit,
              item.unit_price,
              item.sort_order
            FROM quotation_items item
            LEFT JOIN quotations quotation
              ON quotation.id = item.quotation_id
             AND quotation.deleted_at IS NULL
            WHERE item.id IN (${quotationItemIds.map(() => '?').join(',')})
              AND item.deleted_at IS NULL
          `,
          quotationItemIds,
        )
      : [];
    const customerCodes = this.uniqueTextValues([
      ...projects.map((project) => project.customer_code).filter(Boolean),
      ...requirements
        .map((requirement) => requirement.customer_code)
        .filter(Boolean),
    ]);
    const customerRows: Array<{
      customer_code: string;
      customer_name: string;
    }> = customerCodes.length
      ? await this.dataSource.query(
          `
            SELECT customer_code, customer_name
            FROM customers
            WHERE customer_code IN (${customerCodes.map(() => '?').join(',')})
              AND deleted_at IS NULL
          `,
          customerCodes,
        )
      : [];

    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    const itemById = new Map(requirementItems.map((item) => [item.id, item]));
    const requirementById = new Map(
      requirements.map((requirement) => [requirement.id, requirement]),
    );
    const quotationItemById = new Map(
      quotationItems.map((item) => [item.id, item]),
    );
    const customerNameByCode = new Map(
      customerRows.map((customer) => [
        customer.customer_code,
        customer.customer_name,
      ]),
    );
    const assigneeById = new Map(assignees.map((user) => [user.id, user]));
    const filesByTaskId = new Map<string, TaskResultFileEntity[]>();
    for (const file of files.filter((file) => !file.deleted_at)) {
      const current = filesByTaskId.get(file.task_id) ?? [];
      current.push(file);
      filesByTaskId.set(file.task_id, current);
    }

    const groups = await Promise.all(
      tasks.map(async (task) => {
        const requirementItem = task.requirement_item_id
          ? (itemById.get(task.requirement_item_id) ?? null)
          : null;
        const requirement = requirementItem
          ? (requirementById.get(requirementItem.requirement_id) ?? null)
          : null;
        const taskFiles = filesByTaskId.get(task.id) ?? [];
        const imageFiles = taskFiles.filter((file) =>
          this.isExportableImageFile(file),
        );
        const images = await Promise.all(
          imageFiles.map(async (file) => ({
            file,
            ...(await this.loadExportImage(file.file_url)),
          })),
        );
        return {
          task,
          project: projectById.get(task.project_id) ?? null,
          customerName:
            customerNameByCode.get(
              requirement?.customer_code ??
                projectById.get(task.project_id)?.customer_code ??
                '',
            ) ?? null,
          requirement,
          requirementItem,
          quotationItem: requirementItem
            ? (quotationItemById.get(
                quotationItemIdByRequirementItemId.get(requirementItem.id) ??
                  '',
              ) ?? null)
            : null,
          assignee: task.assignee_user_id
            ? (assigneeById.get(task.assignee_user_id) ?? null)
            : null,
          images,
        };
      }),
    );

    return groups.sort((a, b) =>
      this.assetGroupSortKey(a).localeCompare(
        this.assetGroupSortKey(b),
        'zh-Hans-CN',
      ),
    );
  }

  private assetGroupSortKey(group: ExportAssetTaskGroup) {
    return [
      group.quotationItem?.quotation_no ?? '',
      `${Number(group.quotationItem?.sort_order ?? 999999)}`.padStart(6, '0'),
      this.assetQuotationItemLabel(group),
      group.project?.customer_code ?? '',
      group.requirement?.requirement_code ?? '',
      group.requirementItem?.item_no ?? '',
      group.task.task_no ?? '',
      group.task.created_at?.toISOString?.() ?? '',
    ].join('|');
  }

  private buildAssetQuotationSections(groups: ExportAssetTaskGroup[]) {
    const sectionByKey = new Map<string, ExportAssetQuotationSection>();
    for (const group of groups) {
      const pathParts = this.assetQuotationPathParts(group.quotationItem);
      const key = group.quotationItem?.id ?? `unmapped:${pathParts.join('>')}`;
      let section = sectionByKey.get(key);
      if (!section) {
        section = {
          key,
          quotationItem: group.quotationItem,
          pathParts,
          groups: [],
          imageCount: 0,
          loadedImageCount: 0,
        };
        sectionByKey.set(key, section);
      }
      section.groups.push(group);
      section.imageCount += group.images.length;
      section.loadedImageCount += group.images.filter(
        (image) => image.dataUri,
      ).length;
    }
    return [...sectionByKey.values()].sort((a, b) =>
      this.assetSectionSortKey(a).localeCompare(
        this.assetSectionSortKey(b),
        'zh-Hans-CN',
      ),
    );
  }

  private assetSectionSortKey(section: ExportAssetQuotationSection) {
    return [
      section.quotationItem?.quotation_no ?? '',
      `${Number(section.quotationItem?.sort_order ?? 999999)}`.padStart(6, '0'),
      this.assetQuotationPathLabel(section.pathParts),
    ].join('|');
  }

  private addAssetDocumentSlides(
    pptx: pptxgen,
    sections: ExportAssetQuotationSection[],
    title = this.assetDocumentTitle(sections),
  ) {
    let slide = this.addAssetDocumentPage(pptx, title);
    let currentY = 1.08;
    const leftX = 0.76;
    const columnGap = 0.38;
    const columnW = 5.75;
    const captionH = 0.25;
    const imageH = 2.06;
    const rowGap = 0.34;
    const bottomY = 7.18;

    sections.forEach((section, sectionIndex) => {
      const images = section.groups.flatMap((group) => group.images);
      if (!images.length) return;
      const sectionTitle = this.assetQuotationDisplayPathLabel(
        section.pathParts,
      );
      if (currentY > 1.12 && currentY + 0.5 > bottomY) {
        slide = this.addAssetDocumentPage(pptx, title);
        currentY = 1.08;
      }
      this.addAssetDocumentSectionTitle(
        slide,
        sectionIndex + 1,
        sectionTitle,
        currentY,
      );
      currentY += 0.42;

      images.forEach((image, imageIndex) => {
        const columnIndex = imageIndex % 2;
        const isRowStart = columnIndex === 0;
        if (!isRowStart && currentY + imageH + captionH > bottomY) {
          slide = this.addAssetDocumentPage(pptx, title);
          currentY = 1.08;
          this.addAssetDocumentSectionTitle(
            slide,
            sectionIndex + 1,
            `${sectionTitle}（续）`,
            currentY,
          );
          currentY += 0.42;
        }
        if (isRowStart && currentY + imageH + captionH > bottomY) {
          slide = this.addAssetDocumentPage(pptx, title);
          currentY = 1.08;
          this.addAssetDocumentSectionTitle(
            slide,
            sectionIndex + 1,
            `${sectionTitle}（续）`,
            currentY,
          );
          currentY += 0.42;
        }
        const x = leftX + columnIndex * (columnW + columnGap);
        this.addAssetDocumentImage(slide, image, {
          x,
          y: currentY,
          w: columnW,
          h: imageH,
          caption: this.assetImageName(image),
          captionH,
        });
        if (columnIndex === 1 || imageIndex === images.length - 1) {
          currentY += imageH + captionH + rowGap;
        }
      });
      currentY += 0.12;
    });
  }

  private addAssetDocumentPage(pptx: pptxgen, title: string) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addText(title, {
      x: 0.7,
      y: 0.36,
      w: 11.95,
      h: 0.42,
      fontSize: 21,
      bold: true,
      color: '16221B',
      margin: 0,
      fit: 'shrink',
    });
    slide.addShape('line', {
      x: 0.7,
      y: 0.88,
      w: 11.95,
      h: 0,
      line: { color: 'DDE5D8', pt: 1 },
    });
    return slide;
  }

  private addAssetDocumentSectionTitle(
    slide: pptxgen.Slide,
    index: number,
    title: string,
    y: number,
  ) {
    slide.addShape('roundRect', {
      x: 0.76,
      y: y - 0.02,
      w: 0.5,
      h: 0.28,
      rectRadius: 0.04,
      fill: { color: 'EAF2E8' },
      line: { color: 'C9D8C8', pt: 0.7 },
    });
    slide.addText(`${index}）`, {
      x: 0.84,
      y: y + 0.03,
      w: 0.34,
      h: 0.16,
      fontSize: 10,
      bold: true,
      color: '2F6B45',
      margin: 0,
      fit: 'shrink',
    });
    slide.addText(title, {
      x: 1.35,
      y,
      w: 11.22,
      h: 0.28,
      fontSize: 13,
      bold: true,
      color: '243329',
      margin: 0,
      fit: 'shrink',
    });
  }

  private addAssetDocumentImage(
    slide: pptxgen.Slide,
    image: ExportAssetImage,
    slot: {
      x: number;
      y: number;
      w: number;
      h: number;
      caption: string;
      captionH: number;
    },
  ) {
    if (image.dataUri) {
      slide.addImage({
        data: image.dataUri,
        x: slot.x,
        y: slot.y,
        w: slot.w,
        h: slot.h,
        sizing: {
          type: 'contain',
          w: slot.w,
          h: slot.h,
        },
      });
    } else {
      slide.addText(image.error ?? '图片读取失败', {
        x: slot.x,
        y: slot.y,
        w: slot.w,
        h: slot.h,
        fontSize: 13,
        color: 'A15C20',
        align: 'center',
        margin: 0.1,
        fit: 'shrink',
      });
    }
    slide.addText(slot.caption, {
      x: slot.x,
      y: slot.y + slot.h + 0.08,
      w: slot.w,
      h: slot.captionH,
      fontSize: 9,
      color: '596657',
      align: 'center',
      margin: 0,
      fit: 'shrink',
    });
  }

  private assetQuotationItemLabel(group: ExportAssetTaskGroup) {
    return this.assetQuotationPathLabel(
      this.assetQuotationPathParts(group.quotationItem),
    );
  }

  private assetDocumentTitle(sections: ExportAssetQuotationSection[]) {
    const groups = sections.flatMap((section) => section.groups);
    const firstGroup = groups[0] ?? null;
    const fundName =
      firstGroup?.customerName ||
      firstGroup?.project?.customer_code ||
      firstGroup?.requirement?.customer_code ||
      '基金';
    const normalizedFundName = fundName.includes('基金')
      ? fundName
      : `${fundName}基金`;
    return `${normalizedFundName}-结算项目`;
  }

  private safeExportFileName(value: string) {
    return (
      String(value || '资产导出')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '')
        .slice(0, 80) || '资产导出'
    );
  }

  private assetQuotationItemName(item: ExportAssetQuotationItem | null) {
    return item?.item_name || '未关联报价子项';
  }

  private assetQuotationPathParts(item: ExportAssetQuotationItem | null) {
    const text = this.assetQuotationItemName(item)
      .replace(/\r?\n/g, ' > ')
      .replace(/\s*[＞>]\s*/g, ' > ');
    const parts = text
      .split(' > ')
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length ? parts : ['未关联报价子项'];
  }

  private assetQuotationPathLabel(parts: string[]) {
    return parts.filter(Boolean).join(' > ') || '未关联报价子项';
  }

  private assetQuotationDisplayPathLabel(parts: string[]) {
    const compactParts = parts.filter((part, index) => {
      const previous = parts[index - 1];
      return part && part !== previous;
    });
    return this.assetQuotationPathLabel(compactParts);
  }

  private assetQuotationLeafName(parts: string[]) {
    return parts[parts.length - 1] || this.assetQuotationPathLabel(parts);
  }

  private assetImageName(image: ExportAssetImage) {
    const fileName = image.file?.file_name?.trim() || '';
    const parsedName = this.assetImageNameFromUrl(image.file?.file_url);
    if (!fileName || /^图片-\d+$/i.test(fileName)) {
      return parsedName || fileName || '未命名图片';
    }
    return fileName;
  }

  private assetImageNameFromUrl(fileUrl?: string | null) {
    const rawName = String(fileUrl ?? '')
      .split(/[?#]/)[0]
      .split(/[\\/]/)
      .filter(Boolean)
      .pop();
    if (!rawName) return '';
    const withoutExt = rawName.replace(/\.[^.]+$/, '');
    const withoutHash = withoutExt.replace(/[-_][0-9a-f]{8,}$/i, '');
    return withoutHash
      .replace(/^(\d+)[-_]/, '$1 ')
      .replace(/[_-]+/g, ' ')
      .trim();
  }

  private isExportableImageFile(file: TaskResultFileEntity) {
    const source = String(file.source ?? '').toLowerCase();
    return (
      source.includes('image') || this.imageMimeFromUrl(file.file_url) !== null
    );
  }

  private async loadExportImage(fileUrl: string): Promise<{
    dataUri: string | null;
    error?: string;
  }> {
    try {
      const buffer = await this.readExportImageBuffer(fileUrl);
      if (!buffer) {
        return { dataUri: null, error: '图片地址不可读取' };
      }
      const mime =
        this.imageMimeFromUrl(fileUrl) ?? this.imageMimeFromBuffer(buffer);
      if (!mime) {
        return { dataUri: null, error: '图片格式不支持' };
      }
      return {
        dataUri: `data:${mime};base64,${buffer.toString('base64')}`,
      };
    } catch (error) {
      return {
        dataUri: null,
        error: error instanceof Error ? error.message : '图片读取失败',
      };
    }
  }

  private async readExportImageBuffer(fileUrl: string) {
    if (fileUrl.startsWith('/uploads/')) {
      const publicDir = resolve(process.cwd(), 'public');
      const relativePath = fileUrl.split(/[?#]/)[0].replace(/^\/+/, '');
      const filePath = resolve(publicDir, relativePath);
      if (
        filePath !== publicDir &&
        !filePath.startsWith(`${publicDir}${sep}`)
      ) {
        throw new BadRequestException('Invalid local image path');
      }
      return readFile(filePath);
    }
    if (!/^https?:\/\//i.test(fileUrl)) {
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(fileUrl, { signal: controller.signal });
      if (!response.ok) {
        return null;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().startsWith('image/')) {
        return null;
      }
      const bytes = await response.arrayBuffer();
      return Buffer.from(bytes);
    } finally {
      clearTimeout(timeout);
    }
  }

  private imageMimeFromUrl(fileUrl: string) {
    const ext = extname(fileUrl.split(/[?#]/)[0]).toLowerCase();
    const mimeByExt: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return mimeByExt[ext] ?? null;
  }

  private imageMimeFromBuffer(buffer: Buffer) {
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return 'image/jpeg';
    }
    if (
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'image/png';
    }
    if (buffer.subarray(0, 3).toString('ascii') === 'GIF') {
      return 'image/gif';
    }
    if (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
    return null;
  }

  private dateStamp() {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  async listResultFiles(id: string) {
    await this.findOne(id);
    return this.taskResultFilesRepository.find({
      where: { task_id: id },
      order: { created_at: 'DESC' },
    });
  }

  async listResultFilesForUser(id: string, actingUserId: string | null) {
    const task = await this.findOne(id);
    await this.assertCanViewTaskAssets(task, actingUserId);
    return this.taskResultFilesRepository.find({
      where: { task_id: id },
      order: { created_at: 'DESC' },
    });
  }

  async getAssetReviewContext(
    id: string,
    token?: string,
    authorizationHeader?: string,
  ) {
    const task = await this.findOne(id);
    const access = await this.assertAssetReviewAccess(
      task,
      token,
      authorizationHeader,
    );
    const [
      project,
      requirementItem,
      assignee,
      reporter,
      dispatcher,
      productReviewer,
      customerReviewer,
      files,
      detailRows,
    ] = await Promise.all([
      this.projectsRepository.findOne({ where: { id: task.project_id } }),
      task.requirement_item_id
        ? this.requirementItemsRepository.findOne({
            where: { id: task.requirement_item_id },
          })
        : Promise.resolve(null),
      task.assignee_user_id
        ? this.usersRepository.findOne({ where: { id: task.assignee_user_id } })
        : Promise.resolve(null),
      task.reporter_user_id
        ? this.usersRepository.findOne({ where: { id: task.reporter_user_id } })
        : Promise.resolve(null),
      task.dispatcher_user_id
        ? this.usersRepository.findOne({
            where: { id: task.dispatcher_user_id },
          })
        : Promise.resolve(null),
      task.product_reviewer_user_id
        ? this.usersRepository.findOne({
            where: { id: task.product_reviewer_user_id },
          })
        : Promise.resolve(null),
      task.customer_reviewer_user_id
        ? this.usersRepository.findOne({
            where: { id: task.customer_reviewer_user_id },
          })
        : Promise.resolve(null),
      this.taskResultFilesRepository.find({
        where: { task_id: id },
        order: { created_at: 'ASC' },
      }),
      this.dataSource.query(
        `
            SELECT
              requirement.id AS requirementId,
              requirement.requirement_code AS requirementCode,
              requirement.title AS requirementTitle,
              requirement.raw_content AS requirementContent,
              requirement.summary AS requirementSummary,
              requirement.business_name AS businessName,
              requirement.business_platform AS businessPlatform,
              customer.customer_name AS customerName
            FROM tasks task
            LEFT JOIN requirement_items item ON item.id = task.requirement_item_id
            LEFT JOIN requirements requirement ON requirement.id = item.requirement_id
            LEFT JOIN customers customer ON customer.customer_code = requirement.customer_code
            WHERE task.id = ?
            LIMIT 1
          `,
        [task.id],
      ),
    ]);
    const detail = detailRows?.[0] ?? {};
    const imageFiles = files.filter((file) => this.isReviewImageFile(file));
    const linkFiles = files.filter((file) => this.isReviewLinkFile(file));
    const otherFiles = files.filter(
      (file) => !this.isReviewImageFile(file) && !this.isReviewLinkFile(file),
    );

    const isLegacyPendingReview =
      task.status === TaskStatus.PendingReview &&
      (!task.review_stage || task.review_stage === TaskReviewStage.None);
    const canProductReview =
      task.status === TaskStatus.PendingReview &&
      task.review_stage === TaskReviewStage.ProductReview &&
      Boolean(access.userId) &&
      (await this.canProductReviewTask(task, access.userId));
    const canCustomerReview =
      task.status === TaskStatus.PendingReview &&
      (task.review_stage === TaskReviewStage.CustomerReview ||
        isLegacyPendingReview) &&
      Boolean(access.userId) &&
      (await this.canCustomerReviewTask(task, access.userId));
    const reviewStageLabel = isLegacyPendingReview
      ? taskReviewStageLabel(TaskReviewStage.CustomerReview)
      : taskReviewStageLabel(task.review_stage);

    return {
      task: {
        ...task,
        status_label: taskDisplayStatusLabel(
          task.status,
          task.review_stage,
          task.blocked_reason,
        ),
        review_stage_label: reviewStageLabel,
      },
      reviewStage: task.review_stage ?? TaskReviewStage.None,
      reviewStageLabel: reviewStageLabel,
      project,
      requirement: {
        id: detail.requirementId ?? null,
        requirement_code: detail.requirementCode ?? null,
        title: detail.requirementTitle ?? task.task_name,
        content:
          detail.requirementContent ??
          detail.requirementSummary ??
          task.description ??
          '',
        business_name: detail.businessName ?? null,
        business_platform: detail.businessPlatform ?? null,
        customer_name: detail.customerName ?? project?.project_name ?? null,
      },
      requirementItem,
      assignee: assignee ? this.publicUserSummary(assignee) : null,
      reporter: reporter ? this.publicUserSummary(reporter) : null,
      dispatcher: dispatcher ? this.publicUserSummary(dispatcher) : null,
      productReviewer: productReviewer
        ? this.publicUserSummary(productReviewer)
        : null,
      customerReviewer: customerReviewer
        ? this.publicUserSummary(customerReviewer)
        : null,
      assets: {
        images: imageFiles.map((file) => this.assetReviewFile(file)),
        links: linkFiles.map((file) => this.assetReviewFile(file)),
        others: otherFiles.map((file) => this.assetReviewFile(file)),
        imageCount: imageFiles.length,
        totalCount: files.length,
        billableCount: this.billableAssetCount(files),
      },
      canProductReview,
      canCustomerReview,
      canReview: canProductReview || canCustomerReview,
      viewerSession:
        access.mode === 'token' && access.userId
          ? await this.publicUserSession(access.userId)
          : null,
    };
  }

  async approveAssetReview(
    id: string,
    token?: string,
    authorizationHeader?: string,
  ) {
    const task = await this.findOne(id);
    const access = await this.assertAssetReviewAccess(
      task,
      token,
      authorizationHeader,
      true,
    );
    const reviewerUserId = access.userId;
    if (!reviewerUserId) {
      throw new UnauthorizedException('No review user found');
    }
    if (
      task.status === TaskStatus.PendingReview &&
      task.review_stage === TaskReviewStage.ProductReview
    ) {
      return this.approveProductReview(task, reviewerUserId);
    }
    if (
      task.status === TaskStatus.PendingReview &&
      task.review_stage === TaskReviewStage.CustomerReview
    ) {
      return this.approveCustomerReview(task, reviewerUserId);
    }
    if (
      task.status === TaskStatus.PendingReview &&
      (!task.review_stage || task.review_stage === TaskReviewStage.None)
    ) {
      return this.approveCustomerReview(task, reviewerUserId);
    }
    throw new BadRequestException('当前任务不在可审核阶段');
  }

  async returnAssetReview(
    id: string,
    reason: string,
    token?: string,
    authorizationHeader?: string,
  ) {
    const task = await this.findOne(id);
    const access = await this.assertAssetReviewAccess(
      task,
      token,
      authorizationHeader,
      true,
    );
    const reviewerUserId = access.userId;
    if (!reviewerUserId) {
      throw new UnauthorizedException('No review user found');
    }
    const trimmedReason = String(reason ?? '').trim();
    if (!trimmedReason) {
      throw new BadRequestException('请填写退回修改原因');
    }
    return this.returnReview(task, reviewerUserId, trimmedReason);
  }

  private async approveProductReview(task: TaskEntity, reviewerUserId: string) {
    if (!(await this.canProductReviewTask(task, reviewerUserId))) {
      throw new UnauthorizedException(
        'No permission to approve product review',
      );
    }
    const fromStatus = task.status;
    const fromReviewStage = task.review_stage ?? TaskReviewStage.None;
    const reviewer = await this.usersRepository.findOne({
      where: { id: reviewerUserId },
    });
    const transition = await this.dataSource.query(
      `
        UPDATE tasks
        SET review_stage = ?,
            product_reviewer_user_id = ?,
            current_step = 'second_review',
            returned_from_step = NULL,
            progress_percent = GREATEST(COALESCE(progress_percent, 0), 95),
            blocked_reason = NULL,
            workflow_version = COALESCE(workflow_version, 0) + 1,
            last_transition_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL
          AND status = ?
          AND review_stage = ?
      `,
      [
        TaskReviewStage.CustomerReview,
        reviewerUserId,
        task.id,
        TaskStatus.PendingReview,
        TaskReviewStage.ProductReview,
      ],
    );
    this.assertReviewTransitionWon(transition, '一审');
    const saved = await this.findOne(task.id);
    await this.taskWorkflowRuntime.completeStep(
      saved.id,
      TaskWorkflowStep.FirstReview,
      reviewerUserId,
      'approved',
    );
    await this.taskWorkflowRuntime.syncTaskCurrentStep(saved);
    await this.recordTaskReview(
      saved,
      TaskReviewStage.ProductReview,
      'approved',
      reviewerUserId,
      fromStatus,
      saved.status,
      fromReviewStage,
      saved.review_stage,
      null,
    );
    const customerReviewerIds = await this.customerReviewerIds(saved);
    const notification =
      await this.notificationsService.notifyTaskProductReviewApproved(
        saved,
        reviewer?.display_name ?? reviewer?.username ?? '成品负责人',
        customerReviewerIds,
      );
    return {
      task: saved,
      workflow: buildTaskWorkflowSnapshot(saved),
      notification,
    };
  }

  private async approveCustomerReview(
    task: TaskEntity,
    reviewerUserId: string,
  ) {
    if (!(await this.canCustomerReviewTask(task, reviewerUserId))) {
      throw new UnauthorizedException(
        'No permission to approve customer review',
      );
    }
    const fromStatus = task.status;
    const fromReviewStage = task.review_stage ?? TaskReviewStage.None;
    const completedStatus = assertTaskStatusTransition(
      task.status,
      TaskStatus.Completed,
    );
    const transition = await this.dataSource.query(
      `
        UPDATE tasks
        SET status = ?,
            review_stage = ?,
            current_step = 'done',
            returned_from_step = NULL,
            customer_reviewer_user_id = ?,
            progress_percent = 100,
            actual_end_at = CURRENT_TIMESTAMP,
            blocked_reason = NULL,
            workflow_version = COALESCE(workflow_version, 0) + 1,
            last_transition_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL
          AND status = ?
          AND (
            review_stage = ?
            OR review_stage = ?
            OR review_stage IS NULL
          )
      `,
      [
        completedStatus,
        TaskReviewStage.Done,
        reviewerUserId,
        task.id,
        TaskStatus.PendingReview,
        TaskReviewStage.CustomerReview,
        TaskReviewStage.None,
      ],
    );
    this.assertReviewTransitionWon(transition, '二审');
    const saved = await this.findOne(task.id);
    await this.taskWorkflowRuntime.completeStep(
      saved.id,
      TaskWorkflowStep.SecondReview,
      reviewerUserId,
      'approved',
    );
    await this.taskWorkflowRuntime.syncTaskCurrentStep(saved);
    await this.recordTaskStatusHistory(
      saved,
      fromStatus,
      saved.status,
      'customer_review_approved',
      null,
    );
    await this.recordTaskReview(
      saved,
      TaskReviewStage.CustomerReview,
      'approved',
      reviewerUserId,
      fromStatus,
      saved.status,
      fromReviewStage,
      saved.review_stage,
      null,
    );
    const assetCount = await this.taskResultFilesRepository.count({
      where: { task_id: task.id },
    });
    const notification =
      await this.notificationsService.notifyTaskCustomerReviewApproved(
        saved,
        assetCount,
        await this.taskCompletionRecipientIds(saved),
      );
    return {
      task: saved,
      workflow: buildTaskWorkflowSnapshot(saved),
      notification,
    };
  }

  private async returnReview(
    task: TaskEntity,
    reviewerUserId: string,
    reason: string,
  ) {
    const stage = task.review_stage ?? TaskReviewStage.None;
    if (
      stage === TaskReviewStage.ProductReview &&
      !(await this.canProductReviewTask(task, reviewerUserId))
    ) {
      throw new UnauthorizedException('No permission to return product review');
    }
    if (
      stage === TaskReviewStage.CustomerReview &&
      !(await this.canCustomerReviewTask(task, reviewerUserId))
    ) {
      throw new UnauthorizedException(
        'No permission to return customer review',
      );
    }
    if (
      stage === TaskReviewStage.None &&
      !(await this.canCustomerReviewTask(task, reviewerUserId))
    ) {
      throw new UnauthorizedException(
        'No permission to return customer review',
      );
    }
    const fromStatus = task.status;
    const fromReviewStage = task.review_stage ?? TaskReviewStage.None;
    const reviewer = await this.usersRepository.findOne({
      where: { id: reviewerUserId },
    });
    const returnedStatus = assertTaskStatusTransition(
      task.status,
      TaskStatus.Returned,
    );
    const returnedFromStep =
      reviewStageToWorkflowStep(stage) ??
      (stage === TaskReviewStage.None ? TaskWorkflowStep.SecondReview : null);
    if (!returnedFromStep) {
      throw new BadRequestException('无法识别当前审核阶段');
    }
    const reviewerColumn =
      returnedFromStep === TaskWorkflowStep.FirstReview
        ? 'product_reviewer_user_id'
        : 'customer_reviewer_user_id';
    const stageCondition =
      stage === TaskReviewStage.None
        ? '(review_stage = ? OR review_stage IS NULL)'
        : 'review_stage = ?';
    const transition = await this.dataSource.query(
      `
        UPDATE tasks
        SET status = ?,
            review_stage = ?,
            current_step = 'execute',
            returned_from_step = ?,
            ${reviewerColumn} = ?,
            progress_percent = 60,
            blocked_reason = ?,
            actual_end_at = NULL,
            workflow_version = COALESCE(workflow_version, 0) + 1,
            last_transition_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL
          AND status = ?
          AND ${stageCondition}
      `,
      [
        returnedStatus,
        TaskReviewStage.None,
        returnedFromStep,
        reviewerUserId,
        reason,
        task.id,
        TaskStatus.PendingReview,
        stage,
      ],
    );
    this.assertReviewTransitionWon(
      transition,
      stage === TaskReviewStage.ProductReview ? '一审' : '二审',
    );
    const saved = await this.findOne(task.id);
    await this.taskWorkflowRuntime.completeStep(
      saved.id,
      returnedFromStep,
      reviewerUserId,
      'returned',
      reason,
    );
    await this.taskWorkflowRuntime.syncTaskCurrentStep(saved);
    await this.recordTaskStatusHistory(
      saved,
      fromStatus,
      saved.status,
      'review_returned',
      reason,
    );
    await this.recordTaskReview(
      saved,
      stage,
      'returned',
      reviewerUserId,
      fromStatus,
      saved.status,
      fromReviewStage,
      saved.review_stage,
      reason,
    );
    const notification =
      await this.notificationsService.notifyTaskReviewReturned(
        saved,
        taskReviewStageLabel(stage),
        reviewer?.display_name ?? reviewer?.username ?? '审核人',
        reason,
        await this.taskReturnRecipientIds(saved),
      );
    return {
      task: saved,
      workflow: buildTaskWorkflowSnapshot(saved),
      notification,
    };
  }

  private assertReviewTransitionWon(result: unknown, stageLabel: string) {
    const queryResult = result as {
      affectedRows?: number;
      0?: { affectedRows?: number };
    };
    const affectedRows = Number(
      queryResult?.affectedRows ?? queryResult?.[0]?.affectedRows ?? 0,
    );
    if (!affectedRows) {
      throw new ConflictException(
        `该任务已由其他${stageLabel}人员处理，请刷新后查看最新状态`,
      );
    }
  }

  private assertAssignmentClaimWon(result: unknown) {
    const queryResult = result as {
      affectedRows?: number;
      0?: { affectedRows?: number };
    };
    const affectedRows = Number(
      queryResult?.affectedRows ?? queryResult?.[0]?.affectedRows ?? 0,
    );
    if (!affectedRows) {
      throw new ConflictException('该任务已由其他派发人接管，请刷新后查看');
    }
  }

  async registerResultFile(
    id: string,
    dto: RegisterTaskResultFileDto,
    actingUserId: string | null,
  ) {
    const task = await this.findOne(id);
    await this.assertCanSubmitTaskAssets(task, actingUserId);
    const file = this.taskResultFilesRepository.create({
      id: randomUUID(),
      task_id: task.id,
      project_id: task.project_id,
      file_name: dto.fileName,
      file_url: dto.fileUrl,
      feishu_file_token: dto.feishuFileToken ?? null,
      uploaded_by_user_id: dto.uploadedByUserId ?? task.assignee_user_id,
      source: dto.feishuFileToken ? 'feishu' : 'manual',
      remark: dto.remark ?? null,
    });

    const saved = await this.taskResultFilesRepository.save(file);
    const notification =
      await this.notificationsService.notifyTaskResultFileSubmitted(
        task,
        saved,
      );
    return {
      file: saved,
      notification,
    };
  }

  private assetReviewFile(file: TaskResultFileEntity) {
    return {
      id: file.id,
      file_name: file.file_name,
      file_url: file.file_url,
      source: file.source,
      remark: file.remark,
      uploaded_by_user_id: file.uploaded_by_user_id,
      created_at: file.created_at,
      is_image: this.isReviewImageFile(file),
      is_link: this.isReviewLinkFile(file),
      display_name: this.assetReviewFileName(file),
    };
  }

  private assetReviewFileName(file: TaskResultFileEntity) {
    const parsedName = this.assetImageNameFromUrl(file.file_url);
    if (!file.file_name || /^图片-\d+$/i.test(file.file_name)) {
      return parsedName || file.file_name || '未命名资产';
    }
    return file.file_name;
  }

  private isReviewImageFile(file: TaskResultFileEntity) {
    return this.isExportableImageFile(file);
  }

  private isReviewLinkFile(file: TaskResultFileEntity) {
    const source = String(file.source ?? '').toLowerCase();
    return source.includes('link') && !this.isReviewImageFile(file);
  }

  private publicUserSummary(user: UserEntity) {
    return {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      source: user.source,
      feishu_open_id: user.feishu_open_id,
    };
  }

  private async notifyProductReviewers(task: TaskEntity, assetCount: number) {
    const reviewerIds = await this.productReviewerIds(task);
    return this.notificationsService.notifyTaskAssetsSubmittedForProductReview(
      task,
      assetCount,
      reviewerIds,
    );
  }

  private async assertCanViewTaskAssets(
    task: TaskEntity,
    actingUserId: string | null,
  ) {
    if (!actingUserId) {
      throw new ForbiddenException('请先登录后查看任务资产');
    }
    const user = await this.usersRepository.findOne({
      where: { id: actingUserId, status: 'active' },
    });
    if (!user) {
      throw new ForbiddenException('当前账号不可用');
    }
    const profile = await buildAccessProfile(this.dataSource, user);
    if (
      profile.isAdmin ||
      [
        task.assignee_user_id,
        task.dispatcher_user_id,
        task.reporter_user_id,
        task.product_reviewer_user_id,
        task.customer_reviewer_user_id,
      ].includes(actingUserId)
    ) {
      return;
    }
    const fallbackOwnerId = task.reporter_user_id
      ? null
      : await this.projectOwnerUserId(task.project_id);
    if (fallbackOwnerId === actingUserId) {
      return;
    }
    const facts = await this.taskReviewFacts(task);
    const businessCategory = normalizeAccessBusinessCategory(
      facts.businessCategory,
    );
    const customerCode = String(facts.customerCode ?? '').trim();
    if (
      profile.ownedBusinessCategoryCodes.includes(businessCategory) ||
      profile.productReviewTypes.includes(businessCategory) ||
      profile.dispatchCustomerCodes.includes(customerCode) ||
      profile.customerReviewCodes.includes(customerCode)
    ) {
      return;
    }
    throw new ForbiddenException('当前账号无权查看该任务资产');
  }

  private async assertCanAssignTask(
    task: TaskEntity,
    actingUserId: string | null,
  ) {
    if (!actingUserId) {
      throw new ForbiddenException('A signed-in dispatcher is required');
    }
    const user = await this.usersRepository.findOne({
      where: { id: actingUserId, status: 'active' },
    });
    if (!user) {
      throw new ForbiddenException('Active dispatcher not found');
    }
    const profile = await buildAccessProfile(this.dataSource, user);
    if (profile.isAdmin || task.dispatcher_user_id === actingUserId) {
      return;
    }
    if (task.dispatcher_user_id) {
      throw new ForbiddenException('该任务已由其他派发人负责');
    }

    const facts = await this.taskReviewFacts(task);
    const customerCode = String(facts.customerCode ?? '').trim();
    const dispatcherIds = customerCode
      ? await this.workflowConfigsService.findCustomerMemberIds(
          customerCode,
          'dispatcher',
        )
      : [];
    if (dispatcherIds.includes(actingUserId)) {
      return;
    }
    if (!customerCode) {
      throw new BadRequestException('任务尚未关联基金，无法校验派发团队');
    }
    if (!dispatcherIds.length) {
      throw new BadRequestException('该基金尚未配置派发团队');
    }
    throw new ForbiddenException('当前账号不能派发该基金的任务');
  }

  private async assertCanSubmitTaskAssets(
    task: TaskEntity,
    actingUserId: string | null,
  ) {
    if (!actingUserId) {
      throw new ForbiddenException('请先登录后再登记交付资产');
    }
    const user = await this.usersRepository.findOne({
      where: { id: actingUserId, status: 'active' },
    });
    if (!user) {
      throw new ForbiddenException('当前账号不可用');
    }
    const profile = await buildAccessProfile(this.dataSource, user);
    if (profile.isAdmin || task.assignee_user_id === actingUserId) {
      return;
    }
    throw new ForbiddenException('只有当前执行人可以登记交付资产');
  }

  private async productReviewerIds(task: TaskEntity) {
    const reviewType =
      task.product_review_type ??
      (await this.resolveTaskProductReviewType(task));
    return this.workflowConfigsService.findBusinessCategoryReviewerIds(
      reviewType,
    );
  }

  private async customerReviewerIds(task: TaskEntity) {
    const facts = await this.taskReviewFacts(task);
    return this.workflowConfigsService.findCustomerMemberIds(
      facts.customerCode,
      'customer_reviewer',
    );
  }

  private async taskCompletionRecipientIds(task: TaskEntity) {
    return [
      ...new Set(
        [
          task.assignee_user_id,
          task.dispatcher_user_id,
          task.reporter_user_id,
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  private async taskReturnRecipientIds(task: TaskEntity) {
    return [
      ...new Set(
        [task.assignee_user_id, task.dispatcher_user_id].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
  }

  private async canProductReviewTask(task: TaskEntity, userId: string | null) {
    if (!userId) return false;
    const reviewerIds = await this.productReviewerIds(task);
    if (reviewerIds.includes(userId)) return true;
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) return false;
    const profile = await buildAccessProfile(this.dataSource, user);
    return profile.isAdmin;
  }

  private async canCustomerReviewTask(task: TaskEntity, userId: string | null) {
    if (!userId) return false;
    const reviewerIds = await this.customerReviewerIds(task);
    if (reviewerIds.includes(userId)) return true;
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) return false;
    const profile = await buildAccessProfile(this.dataSource, user);
    return profile.isAdmin;
  }

  private async resolveTaskProductReviewType(task: TaskEntity) {
    const facts = await this.taskReviewFacts(task);
    return facts.reviewType;
  }

  private async taskReviewFacts(task: TaskEntity): Promise<TaskReviewFacts> {
    const rows: Array<{
      businessCategory: string | null;
      customerCode: string | null;
      customerName: string | null;
      businessPlatform: string | null;
    }> = await this.dataSource.query(
      `
        SELECT
          requirement.business_category AS businessCategory,
          COALESCE(requirement.customer_code, project.customer_code) AS customerCode,
          COALESCE(requirement_customer.customer_name, project_customer.customer_name) AS customerName,
          requirement.business_platform AS businessPlatform
        FROM tasks task
        LEFT JOIN requirement_items item ON item.id = task.requirement_item_id
        LEFT JOIN requirements requirement ON requirement.id = item.requirement_id
        LEFT JOIN projects project ON project.id = task.project_id
        LEFT JOIN customers requirement_customer ON requirement_customer.customer_code = requirement.customer_code
        LEFT JOIN customers project_customer ON project_customer.customer_code = project.customer_code
        WHERE task.id = ?
        LIMIT 1
      `,
      [task.id],
    );
    const row = rows?.[0] ?? {};
    const businessCategory = row.businessCategory ?? null;
    const reviewType = normalizeAccessBusinessCategory(businessCategory);
    return {
      businessCategory,
      reviewType: reviewType || null,
      customerCode: row.customerCode ?? null,
      customerName: row.customerName ?? null,
      businessPlatform: row.businessPlatform ?? null,
    };
  }

  private async assertAssetReviewAccess(
    task: TaskEntity,
    token?: string,
    authorizationHeader?: string,
    requireReviewPermission = false,
  ): Promise<AssetReviewAccess> {
    const reviewerIds = await this.assetReviewReviewerIds(task);
    const matchedReviewerId = reviewerIds.find((reviewerId) =>
      this.safeTokenEqual(token, this.assetReviewToken(task, reviewerId)),
    );
    if (matchedReviewerId) {
      return { mode: 'token', userId: matchedReviewerId };
    }

    const currentUser =
      await this.userFromAuthorizationHeader(authorizationHeader);
    if (!currentUser) {
      throw new UnauthorizedException('Invalid asset review access token');
    }
    const profile = await buildAccessProfile(this.dataSource, currentUser);
    const isOwner = task.reporter_user_id === currentUser.id;
    const isDispatcher = task.dispatcher_user_id === currentUser.id;
    const isAssignee = task.assignee_user_id === currentUser.id;
    const fallbackOwnerId = task.reporter_user_id
      ? null
      : await this.projectOwnerUserId(task.project_id);
    const isFallbackOwner = fallbackOwnerId === currentUser.id;
    const canProductReview = await this.canProductReviewTask(
      task,
      currentUser.id,
    );
    const canCustomerReview = await this.canCustomerReviewTask(
      task,
      currentUser.id,
    );

    if (
      profile.isAdmin ||
      (!requireReviewPermission &&
        (isOwner ||
          isFallbackOwner ||
          isDispatcher ||
          isAssignee ||
          canProductReview ||
          canCustomerReview)) ||
      (requireReviewPermission && (canProductReview || canCustomerReview))
    ) {
      return { mode: 'session', userId: currentUser.id };
    }

    throw new UnauthorizedException('No permission to view task assets');
  }

  private async assetReviewReviewerIds(task: TaskEntity) {
    const ids = [
      ...(await this.productReviewerIds(task)),
      ...(await this.customerReviewerIds(task)),
      task.reporter_user_id,
      task.dispatcher_user_id,
      task.assignee_user_id,
    ].filter((id): id is string => Boolean(id));
    if (!ids.length) {
      const ownerId = await this.projectOwnerUserId(task.project_id);
      if (ownerId) ids.push(ownerId);
    }
    return [...new Set(ids.filter((id): id is string => Boolean(id)))];
  }

  private async projectOwnerUserId(projectId: string) {
    const project = await this.projectsRepository.findOne({
      where: { id: projectId },
    });
    return project?.owner_user_id ?? null;
  }

  private async userFromAuthorizationHeader(authorizationHeader?: string) {
    const match = /^Bearer\s+mvp-(.+)$/i.exec(authorizationHeader ?? '');
    if (!match?.[1]) {
      return null;
    }
    return this.usersRepository.findOne({
      where: { id: match[1], status: 'active' },
    });
  }

  private assetReviewToken(task: TaskEntity, reviewerUserId: string) {
    const secret =
      process.env.TASK_ACCESS_TOKEN_SECRET ??
      process.env.APP_SECRET ??
      process.env.DB_PASSWORD ??
      'xlyq-efficiency-engine-local-secret';
    return createHmac('sha256', secret)
      .update(`asset-review:${task.id}:${task.task_no}:${reviewerUserId}`)
      .digest('hex');
  }

  private safeTokenEqual(left?: string, right?: string) {
    if (!left || !right) {
      return false;
    }
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }
}
