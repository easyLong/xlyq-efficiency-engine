import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateRequirementItemDto } from './dto/create-requirement-item.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { UpdateRequirementItemDto } from './dto/update-requirement-item.dto';
import { RequirementItemEntity } from './entities/requirement-item.entity';
import { RequirementEntity } from './entities/requirement.entity';

@Injectable()
export class RequirementsService {
  constructor(
    @InjectRepository(RequirementEntity)
    private readonly requirementsRepository: Repository<RequirementEntity>,
    @InjectRepository(RequirementItemEntity)
    private readonly requirementItemsRepository: Repository<RequirementItemEntity>,
    @InjectRepository(AiExecutionLogEntity)
    private readonly aiExecutionLogsRepository: Repository<AiExecutionLogEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(projectId?: string) {
    return this.requirementsRepository.find({
      where: projectId ? { project_id: projectId } : {},
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const requirement = await this.requirementsRepository.findOne({
      where: { id },
    });
    if (!requirement) {
      throw new NotFoundException('Requirement not found');
    }
    return requirement;
  }

  async findItems(requirementId: string) {
    return this.requirementItemsRepository.find({
      where: { requirement_id: requirementId },
      order: { created_at: 'ASC' },
    });
  }

  async create(dto: CreateRequirementDto) {
    const code = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;

    const requirement = this.requirementsRepository.create({
      id: randomUUID(),
      requirement_code: code,
      project_id: dto.projectId,
      customer_id: dto.customerId,
      title: dto.title,
      source_type: 'manual',
      status: 'draft',
      priority: 'medium',
      summary: dto.rawContent ?? null,
    });

    const saved = await this.requirementsRepository.save(requirement);
    await this.notificationsService.notifyRequirementCreated(saved);
    return saved;
  }

  async update(id: string, dto: UpdateRequirementDto) {
    const requirement = await this.findOne(id);

    Object.assign(requirement, {
      title: dto.title ?? requirement.title,
      status: dto.status ?? requirement.status,
      priority: dto.priority ?? requirement.priority,
      customer_id: dto.customerId ?? requirement.customer_id,
      raw_content: dto.rawContent ?? requirement.raw_content,
      summary: dto.summary ?? requirement.summary,
    });

    const saved = await this.requirementsRepository.save(requirement);
    await this.notificationsService.notifyRequirementChanged(saved);
    return saved;
  }

  async parse(id: string) {
    const requirement = await this.findOne(id);
    const output = {
      summary: requirement.summary ?? requirement.title,
      businessGoals: [requirement.title],
      suggestedItems: [
        {
          itemTitle: requirement.title,
          priority: requirement.priority ?? 'medium',
          estimatedHours: 8,
        },
      ],
      suggestedRisk: '请项目经理确认需求边界与报价范围',
    };

    const log = this.aiExecutionLogsRepository.create({
      scene_code: 'requirement_parse',
      project_id: requirement.project_id,
      object_type: 'requirement',
      object_id: requirement.id,
      input_json: {
        requirementId: requirement.id,
        title: requirement.title,
        summary: requirement.summary,
      },
      output_json: output,
      model_name: 'manual-fallback',
      status: 'success',
      created_by: null,
    });
    await this.aiExecutionLogsRepository.save(log);

    requirement.status = 'pending_confirm';
    await this.requirementsRepository.save(requirement);

    return {
      aiLogId: log.id,
      structuredResult: output,
    };
  }

  async confirm(id: string) {
    const requirement = await this.findOne(id);
    requirement.status = 'confirmed';
    requirement.confirmed_at = new Date();
    const saved = await this.requirementsRepository.save(requirement);
    await this.notificationsService.notifyRequirementChanged(saved);
    return saved;
  }

  async createItem(requirementId: string, dto: CreateRequirementItemDto) {
    const requirement = await this.findOne(requirementId);
    const count = await this.requirementItemsRepository.count({
      where: { requirement_id: requirementId },
    });
    const itemNo = `${requirement.requirement_code}-ITEM-${String(count + 1).padStart(3, '0')}`;

    const item = this.requirementItemsRepository.create({
      id: randomUUID(),
      requirement_id: requirementId,
      parent_item_id: dto.parentItemId ?? null,
      item_no: itemNo,
      item_title: dto.itemTitle,
      item_description: dto.itemDescription ?? null,
      business_goal: dto.businessGoal ?? null,
      acceptance_criteria: dto.acceptanceCriteria ?? null,
      priority: dto.priority ?? 'medium',
      estimated_hours: dto.estimatedHours ?? null,
      status: 'pending_confirm',
      quote_scope_status: 'not_started',
    });

    return this.requirementItemsRepository.save(item);
  }

  async updateItem(itemId: string, dto: UpdateRequirementItemDto) {
    const item = await this.requirementItemsRepository.findOne({
      where: { id: itemId },
    });
    if (!item) {
      throw new NotFoundException('Requirement item not found');
    }

    Object.assign(item, {
      parent_item_id: dto.parentItemId ?? item.parent_item_id,
      item_title: dto.itemTitle ?? item.item_title,
      item_description: dto.itemDescription ?? item.item_description,
      business_goal: dto.businessGoal ?? item.business_goal,
      acceptance_criteria:
        dto.acceptanceCriteria ?? item.acceptance_criteria,
      priority: dto.priority ?? item.priority,
      estimated_hours: dto.estimatedHours ?? item.estimated_hours,
      status: dto.status ?? item.status,
      quote_scope_status: dto.quoteScopeStatus ?? item.quote_scope_status,
    });

    return this.requirementItemsRepository.save(item);
  }

  async confirmItem(itemId: string) {
    const item = await this.updateItem(itemId, { status: 'confirmed' });
    await this.notificationsService.notifyRequirementItemConfirmed(item);
    return item;
  }

  async obsoleteItem(itemId: string) {
    return this.updateItem(itemId, {
      status: 'obsolete',
      quoteScopeStatus: 'changed',
    });
  }

  async listItems(projectId?: string, requirementId?: string, status?: string) {
    const requirementIds =
      projectId && !requirementId
        ? (
            await this.requirementsRepository.find({
              select: { id: true },
              where: { project_id: projectId },
            })
          ).map((item) => item.id)
        : undefined;

    if (projectId && requirementIds && requirementIds.length === 0) {
      return [];
    }

    const qb = this.requirementItemsRepository.createQueryBuilder('ri');
    if (requirementId) {
      qb.andWhere('ri.requirement_id = :requirementId', { requirementId });
    }
    if (status) {
      qb.andWhere('ri.status = :status', { status });
    }
    if (requirementIds) {
      qb.andWhere('ri.requirement_id IN (:...requirementIds)', {
        requirementIds,
      });
    }
    return qb.orderBy('ri.created_at', 'ASC').getMany();
  }
}
