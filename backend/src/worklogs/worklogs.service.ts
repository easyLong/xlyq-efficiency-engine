import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { CreateWorklogDto } from './dto/create-worklog.dto';
import { UpdateWorklogDto } from './dto/update-worklog.dto';

@Injectable()
export class WorklogsService {
  constructor(
    @InjectRepository(WorklogEntity)
    private readonly worklogsRepository: Repository<WorklogEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
  ) {}

  async findAll(
    projectId?: string,
    taskId?: string,
    userId?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const qb = this.worklogsRepository.createQueryBuilder('w');
    if (projectId) {
      qb.andWhere('w.project_id = :projectId', { projectId });
    }
    if (taskId) {
      qb.andWhere('w.task_id = :taskId', { taskId });
    }
    if (userId) {
      qb.andWhere('w.user_id = :userId', { userId });
    }
    if (dateFrom) {
      qb.andWhere('w.work_date >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      qb.andWhere('w.work_date <= :dateTo', { dateTo });
    }
    return qb.orderBy('w.work_date', 'DESC').addOrderBy('w.created_at', 'DESC').getMany();
  }

  async findOne(worklogId: string) {
    const worklog = await this.worklogsRepository.findOne({ where: { id: worklogId } });
    if (!worklog) {
      throw new NotFoundException('Worklog not found');
    }
    return worklog;
  }

  async create(dto: CreateWorklogDto) {
    const worklog = this.worklogsRepository.create({
      id: randomUUID(),
      project_id: dto.projectId,
      task_id: dto.taskId,
      requirement_item_id: dto.requirementItemId ?? null,
      user_id: dto.userId,
      work_date: dto.workDate,
      hours: dto.hours,
      work_summary: dto.workSummary ?? null,
      source: dto.source ?? 'manual',
      approval_status: 'draft',
    });
    const saved = await this.worklogsRepository.save(worklog);
    await this.syncTaskActualHours(dto.taskId);
    return saved;
  }

  async update(worklogId: string, dto: UpdateWorklogDto) {
    const worklog = await this.findOne(worklogId);
    Object.assign(worklog, {
      requirement_item_id: dto.requirementItemId ?? worklog.requirement_item_id,
      user_id: dto.userId ?? worklog.user_id,
      work_date: dto.workDate ?? worklog.work_date,
      hours: dto.hours ?? worklog.hours,
      work_summary: dto.workSummary ?? worklog.work_summary,
      approval_status: dto.approvalStatus ?? worklog.approval_status,
    });
    const saved = await this.worklogsRepository.save(worklog);
    await this.syncTaskActualHours(worklog.task_id);
    return saved;
  }

  async remove(worklogId: string) {
    const worklog = await this.findOne(worklogId);
    await this.worklogsRepository.softDelete(worklogId);
    await this.syncTaskActualHours(worklog.task_id);
    return { success: true };
  }

  async submit(worklogId: string) {
    return this.update(worklogId, { approvalStatus: 'submitted' });
  }

  async approve(worklogId: string) {
    return this.update(worklogId, { approvalStatus: 'approved' });
  }

  private async syncTaskActualHours(taskId: string) {
    const raw = await this.worklogsRepository
      .createQueryBuilder('w')
      .select('COALESCE(SUM(w.hours), 0)', 'total')
      .where('w.task_id = :taskId', { taskId })
      .getRawOne<{ total: string }>();

    const task = await this.tasksRepository.findOne({ where: { id: taskId } });
    if (!task) {
      return;
    }
    task.actual_hours = Number(raw?.total ?? 0).toFixed(2);
    await this.tasksRepository.save(task);
  }
}
