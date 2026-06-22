import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { buildAccessProfile } from '../common/access-control';
import { ProjectEntity } from '../projects/entities/project.entity';
import { QuotationEntity } from '../quotations/entities/quotation.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
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
    private readonly dataSource: DataSource,
  ) {}

  async overview(currentUser: UserEntity | null = null) {
    const profile = currentUser
      ? await buildAccessProfile(this.dataSource, currentUser)
      : null;
    const quoteVisible = profile?.dataScope.quotes === 'all';
    const now = new Date();
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
    const trueOverdueTasks = await this.tasksRepository
      .createQueryBuilder('task')
      .where('task.status != :completed', { completed: 'completed' })
      .andWhere('task.planned_end_at IS NOT NULL')
      .andWhere('task.planned_end_at < :now', { now })
      .getCount();

    return {
      inProgressProjects,
      pendingTasks,
      overdueTasks: trueOverdueTasks,
      pendingMappings,
      pendingQuotations,
      totalQuotationAmount: quoteVisible ? Number(quotationAmount?.total ?? 0) : null,
    };
  }
}
