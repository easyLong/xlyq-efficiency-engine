import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { RequirementEntity } from '../requirements/entities/requirement.entity';
import { RiskAlertEntity } from '../common/entities/risk-alert.entity';
import { QuotationEntity } from '../quotations/entities/quotation.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectEntity } from './entities/project.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @InjectRepository(RequirementEntity)
    private readonly requirementsRepository: Repository<RequirementEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(QuotationEntity)
    private readonly quotationsRepository: Repository<QuotationEntity>,
    @InjectRepository(RiskAlertEntity)
    private readonly riskAlertsRepository: Repository<RiskAlertEntity>,
  ) {}

  async findAll(status?: string) {
    return this.projectsRepository.find({
      where: status ? { status } : {},
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const project = await this.projectsRepository.findOne({ where: { id } });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  async create(dto: CreateProjectDto) {
    const code = `PRJ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;

    const project = this.projectsRepository.create({
      id: randomUUID(),
      project_code: code,
      project_name: dto.projectName,
      customer_id: dto.customerId,
      owner_user_id: dto.ownerUserId,
      project_type: dto.projectType ?? null,
      status: 'pending',
      priority: dto.priority ?? 'medium',
      budget_amount: dto.budgetAmount ?? null,
      planned_end_date: dto.plannedEndDate ?? null,
      description: dto.description ?? null,
    });

    return this.projectsRepository.save(project);
  }

  async update(id: string, dto: UpdateProjectDto) {
    const project = await this.findOne(id);

    Object.assign(project, {
      project_name: dto.projectName ?? project.project_name,
      customer_id: dto.customerId ?? project.customer_id,
      owner_user_id: dto.ownerUserId ?? project.owner_user_id,
      project_type: dto.projectType ?? project.project_type,
      status: dto.status ?? project.status,
      priority: dto.priority ?? project.priority,
      budget_amount: dto.budgetAmount ?? project.budget_amount,
      planned_end_date: dto.plannedEndDate ?? project.planned_end_date,
      actual_end_date: dto.actualEndDate ?? project.actual_end_date,
      description: dto.description ?? project.description,
    });

    return this.projectsRepository.save(project);
  }

  async archive(id: string) {
    const project = await this.findOne(id);
    project.status = 'completed';
    return this.projectsRepository.save(project);
  }

  async overview(id: string) {
    await this.findOne(id);
    const [requirementCount, taskCount, quotationCount, openRiskCount] =
      await Promise.all([
        this.requirementsRepository.count({ where: { project_id: id } }),
        this.tasksRepository.count({ where: { project_id: id } }),
        this.quotationsRepository.count({ where: { project_id: id } }),
        this.riskAlertsRepository.count({
          where: { project_id: id, status: 'open' },
        }),
      ]);

    const taskStatusRows = await this.tasksRepository
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('t.project_id = :projectId', { projectId: id })
      .groupBy('t.status')
      .getRawMany<{ status: string; count: string }>();

    return {
      project: await this.findOne(id),
      metrics: {
        requirementCount,
        taskCount,
        quotationCount,
        openRiskCount,
      },
      taskStatusSummary: taskStatusRows.map((row) => ({
        status: row.status,
        count: Number(row.count),
      })),
    };
  }
}
