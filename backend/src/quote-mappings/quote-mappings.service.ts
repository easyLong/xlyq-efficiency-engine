import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { QuotationItemEntity } from '../quotations/entities/quotation-item.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { BatchConfirmQuoteMappingsDto } from './dto/batch-confirm-quote-mappings.dto';
import { CreateQuoteMappingDto } from './dto/create-quote-mapping.dto';
import { UpdateQuoteMappingDto } from './dto/update-quote-mapping.dto';

@Injectable()
export class QuoteMappingsService {
  constructor(
    @InjectRepository(RequirementQuotationMappingEntity)
    private readonly mappingsRepository: Repository<RequirementQuotationMappingEntity>,
    @InjectRepository(RequirementItemEntity)
    private readonly requirementItemsRepository: Repository<RequirementItemEntity>,
    @InjectRepository(QuotationItemEntity)
    private readonly quotationItemsRepository: Repository<QuotationItemEntity>,
    @InjectRepository(WorklogEntity)
    private readonly worklogsRepository: Repository<WorklogEntity>,
    @InjectRepository(AiExecutionLogEntity)
    private readonly aiExecutionLogsRepository: Repository<AiExecutionLogEntity>,
  ) {}

  async workbench(projectId: string) {
    const [requirementItems, mappings, worklogRaw] = await Promise.all([
      this.requirementItemsRepository
        .createQueryBuilder('ri')
        .innerJoin('requirements', 'r', 'ri.requirement_id = r.id')
        .where('r.project_id = :projectId', { projectId })
        .orderBy('ri.created_at', 'ASC')
        .getMany(),
      this.findAll(projectId),
      this.worklogsRepository
        .createQueryBuilder('w')
        .select('COALESCE(SUM(w.hours), 0)', 'totalHours')
        .where('w.project_id = :projectId', { projectId })
        .getRawOne<{ totalHours: string }>(),
    ]);

    const stats = mappings.reduce(
      (acc, item) => {
        acc[item.mapping_status] = (acc[item.mapping_status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      projectId,
      requirementItems,
      mappings,
      totalWorklogHours: Number(worklogRaw?.totalHours ?? 0),
      mappingStatusSummary: stats,
    };
  }

  async suggest(projectId: string) {
    const requirementItems = await this.requirementItemsRepository
      .createQueryBuilder('ri')
      .innerJoin('requirements', 'r', 'ri.requirement_id = r.id')
      .where('r.project_id = :projectId', { projectId })
      .getMany();

    const existingMappings = await this.findAll(projectId);
    const mappedIds = new Set(existingMappings.map((item) => item.requirement_item_id));
    const pendingItems = requirementItems.filter((item) => !mappedIds.has(item.id));

    const suggestions: RequirementQuotationMappingEntity[] = [];
    for (const item of pendingItems) {
      const suggestion = this.mappingsRepository.create({
        id: randomUUID(),
        project_id: projectId,
        requirement_item_id: item.id,
        quotation_id: null,
        quotation_item_id: null,
        mapping_status: 'pending_confirm',
        mapping_type: 'manual',
        matched_ratio: '70.00',
        remark: `建议先为需求项「${item.item_title}」创建或关联报价项`,
      });
      suggestions.push(await this.mappingsRepository.save(suggestion));
    }

    const aiLog = this.aiExecutionLogsRepository.create({
      scene_code: 'quote_mapping',
      project_id: projectId,
      object_type: 'project',
      object_id: projectId,
      input_json: { projectId, requirementItemCount: requirementItems.length },
      output_json: { suggestionCount: suggestions.length },
      model_name: 'manual-fallback',
      status: 'success',
      created_by: null,
    });
    await this.aiExecutionLogsRepository.save(aiLog);

    return {
      aiLogId: aiLog.id,
      suggestions,
    };
  }

  async findAll(projectId?: string, requirementItemId?: string, mappingStatus?: string) {
    const where = {
      ...(projectId ? { project_id: projectId } : {}),
      ...(requirementItemId ? { requirement_item_id: requirementItemId } : {}),
      ...(mappingStatus ? { mapping_status: mappingStatus } : {}),
    };
    return this.mappingsRepository.find({
      where,
      order: { created_at: 'DESC' },
      take: 200,
    });
  }

  async create(dto: CreateQuoteMappingDto) {
    const mapping = this.mappingsRepository.create({
      id: randomUUID(),
      project_id: dto.projectId,
      requirement_item_id: dto.requirementItemId,
      quotation_id: dto.quotationId ?? null,
      quotation_item_id: dto.quotationItemId ?? null,
      mapping_status: dto.mappingStatus ?? 'pending_confirm',
      mapping_type: dto.mappingType ?? 'manual',
      matched_ratio: dto.matchedRatio ?? null,
      remark: dto.remark ?? null,
    });
    return this.mappingsRepository.save(mapping);
  }

  async update(id: string, dto: UpdateQuoteMappingDto) {
    const mapping = await this.mappingsRepository.findOne({ where: { id } });
    if (!mapping) {
      throw new NotFoundException('Quote mapping not found');
    }
    Object.assign(mapping, {
      quotation_id: dto.quotationId ?? mapping.quotation_id,
      quotation_item_id: dto.quotationItemId ?? mapping.quotation_item_id,
      mapping_status: dto.mappingStatus ?? mapping.mapping_status,
      mapping_type: dto.mappingType ?? mapping.mapping_type,
      matched_ratio: dto.matchedRatio ?? mapping.matched_ratio,
      remark: dto.remark ?? mapping.remark,
    });
    return this.mappingsRepository.save(mapping);
  }

  async confirm(id: string) {
    return this.update(id, { mappingStatus: 'matched' });
  }

  async batchConfirm(dto: BatchConfirmQuoteMappingsDto) {
    const results: RequirementQuotationMappingEntity[] = [];
    for (const mappingId of dto.mappingIds) {
      results.push(await this.confirm(mappingId));
    }
    return results;
  }

  async diff(projectId: string) {
    const mappings = await this.findAll(projectId);
    const mappedRequirementItemIds = new Set(
      mappings.map((item) => item.requirement_item_id),
    );
    const allRequirementItems = await this.requirementItemsRepository
      .createQueryBuilder('ri')
      .innerJoin('requirements', 'r', 'ri.requirement_id = r.id')
      .where('r.project_id = :projectId', { projectId })
      .getMany();

    const unmatchedRequirementItems = allRequirementItems.filter(
      (item) => !mappedRequirementItemIds.has(item.id),
    );

    const quotationItems = await this.quotationItemsRepository
      .createQueryBuilder('qi')
      .innerJoin('quotations', 'q', 'qi.quotation_id = q.id')
      .where('q.project_id = :projectId', { projectId })
      .getMany();
    const mappedQuotationItemIds = new Set(
      mappings.map((item) => item.quotation_item_id).filter(Boolean),
    );
    const unmatchedQuotationItems = quotationItems.filter(
      (item) => !mappedQuotationItemIds.has(item.id),
    );

    return {
      unmatchedRequirementItems,
      unmatchedQuotationItems,
      partialMappings: mappings.filter((item) => item.mapping_status === 'partial'),
      pendingMappings: mappings.filter(
        (item) => item.mapping_status === 'pending_confirm',
      ),
    };
  }
}
