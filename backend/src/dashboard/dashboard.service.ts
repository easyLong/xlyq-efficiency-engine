import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { buildAccessProfile, hasPermission } from '../common/access-control';
import { BusinessCalendarService } from '../common/business-calendar.service';
import { ProjectEntity } from '../projects/entities/project.entity';
import { QuotationEntity } from '../quotations/entities/quotation.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { RequirementsService } from '../requirements/requirements.service';
import { TaskResultFileEntity } from '../tasks/entities/task-result-file.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserEntity } from '../users/entities/user.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(QuotationEntity)
    private readonly quotationsRepository: Repository<QuotationEntity>,
    @InjectRepository(RequirementQuotationMappingEntity)
    private readonly mappingsRepository: Repository<RequirementQuotationMappingEntity>,
    @InjectRepository(TaskResultFileEntity)
    private readonly taskResultFilesRepository: Repository<TaskResultFileEntity>,
    private readonly dataSource: DataSource,
    private readonly businessCalendar: BusinessCalendarService,
    private readonly requirementsService: RequirementsService,
    private readonly tasksService: TasksService,
  ) {}

  async analytics(currentUser: UserEntity | null = null) {
    const profile = currentUser
      ? await buildAccessProfile(this.dataSource, currentUser)
      : null;
    const canViewGlobal = Boolean(
      profile && hasPermission(profile, 'dashboard.view_global'),
    );
    const canViewEmployeeLoad = Boolean(
      profile && hasPermission(profile, 'dashboard.employee_detail'),
    );
    const [history, employeeLoad] = await Promise.all([
      this.requirementsService.historyBoard(currentUser, canViewGlobal, {
        workflow: 'none',
        includeQuoteMappings: false,
      }),
      canViewEmployeeLoad && currentUser
        ? this.tasksService.employeeLoad(currentUser.id)
        : Promise.resolve(null),
    ]);
    const taskIds = history.tasks.map((task) => task.id);
    const assetCountByTaskId = await this.loadAssetCounts(taskIds);

    return {
      generatedAt: new Date().toISOString(),
      requirements: history.requirements.map((requirement) => ({
        id: requirement.id,
        project_id: requirement.project_id,
        customer_code: requirement.customer_code,
        title: requirement.title,
        source_type: requirement.source_type,
        source_ref_id: requirement.source_ref_id,
        source_contact_name: requirement.source_contact_name,
        business_name: requirement.business_name,
        business_platform: requirement.business_platform,
        business_category: requirement.business_category,
        secondary_category: requirement.secondary_category,
        tertiary_category: requirement.tertiary_category,
        tertiary_category_codes_json:
          requirement.tertiary_category_codes_json,
        tertiary_category_quantities_json:
          requirement.tertiary_category_quantities_json,
        status: requirement.status,
        priority: requirement.priority,
        urgency_level: requirement.urgency_level,
        summary: requirement.summary,
        created_at: requirement.created_at,
      })),
      requirementItems: history.requirementItems.map((item) => ({
        id: item.id,
        requirement_id: item.requirement_id,
        item_no: item.item_no,
        item_title: item.item_title,
        item_description: item.item_description,
        business_goal: item.business_goal,
        acceptance_criteria: item.acceptance_criteria,
        priority: item.priority,
        urgency_level: item.urgency_level,
        status: item.status,
        contribution_points: item.contribution_points,
        created_at: item.created_at,
      })),
      tasks: history.tasks.map((task) => ({
        id: task.id,
        project_id: task.project_id,
        requirement_item_id: task.requirement_item_id,
        task_no: task.task_no,
        task_name: task.task_name,
        description: task.description,
        status: task.status,
        review_stage: task.review_stage,
        current_step: task.current_step,
        priority: task.priority,
        urgency_level: task.urgency_level,
        assignee_user_id: task.assignee_user_id,
        dispatcher_user_id: task.dispatcher_user_id,
        contribution_points: task.contribution_points,
        progress_percent: task.progress_percent,
        blocked_reason: task.blocked_reason,
        planned_start_at: task.planned_start_at,
        planned_end_at: task.planned_end_at,
        actual_end_at: task.actual_end_at,
        created_at: task.created_at,
        asset_count: assetCountByTaskId.get(task.id) ?? 0,
      })),
      employeeLoad: employeeLoad
        ? {
            ...employeeLoad,
            employees: employeeLoad.employees.map(
              ({ tasks: _tasks, ...employee }) => employee,
            ),
          }
        : null,
    };
  }

  private async loadAssetCounts(taskIds: string[]) {
    if (!taskIds.length) return new Map<string, number>();
    const rows = await this.taskResultFilesRepository
      .createQueryBuilder('file')
      .select('file.task_id', 'taskId')
      .addSelect('COUNT(DISTINCT file.file_url)', 'assetCount')
      .where('file.task_id IN (:...taskIds)', { taskIds })
      .andWhere('file.deleted_at IS NULL')
      .andWhere('file.source IN (:...sources)', {
        sources: [
          'local_asset_sheet',
          'local_asset_sheet_image',
          'feishu_asset_sheet',
          'feishu_asset_sheet_image',
          'manual',
          'feishu',
        ],
      })
      .groupBy('file.task_id')
      .getRawMany<{ taskId: string; assetCount: string }>();
    return new Map(rows.map((row) => [row.taskId, Number(row.assetCount)]));
  }

  async overview(currentUser: UserEntity | null = null) {
    const profile = currentUser
      ? await buildAccessProfile(this.dataSource, currentUser)
      : null;
    const quoteVisible = profile?.dataScope.quotes === 'all';
    const [
      inProgressProjects,
      pendingTasks,
      pendingMappings,
      pendingQuotations,
      quotationAmount,
    ] = await Promise.all([
      this.projectsRepository.count({ where: { status: 'in_progress' } }),
      this.tasksRepository.count({
        where: { status: Not('completed') },
      }),
      quoteVisible
        ? this.mappingsRepository.count({
            where: { mapping_status: 'pending_confirm' },
          })
        : Promise.resolve(null),
      quoteVisible
        ? this.quotationsRepository.count({
            where: { status: 'pending_review' },
          })
        : Promise.resolve(null),
      quoteVisible
        ? this.quotationsRepository
            .createQueryBuilder('q')
            .select('COALESCE(SUM(q.total_amount), 0)', 'total')
            .where('q.status IN (:...statuses)', {
              statuses: ['confirmed', 'settled', 'pending_customer_confirm'],
            })
            .getRawOne()
        : Promise.resolve(null),
    ]);
    const overdueCandidates = await this.tasksRepository
      .createQueryBuilder('task')
      .where('task.status != :completed', { completed: 'completed' })
      .andWhere('task.planned_end_at IS NOT NULL')
      .getMany();
    const overdueFlags = await Promise.all(
      overdueCandidates.map((task) =>
        this.businessCalendar.isOverdue(task.planned_end_at),
      ),
    );
    const trueOverdueTasks = overdueFlags.filter(Boolean).length;

    return {
      inProgressProjects,
      pendingTasks,
      overdueTasks: trueOverdueTasks,
      pendingMappings,
      pendingQuotations,
      totalQuotationAmount: quoteVisible
        ? Number(quotationAmount?.total ?? 0)
        : null,
    };
  }
}
