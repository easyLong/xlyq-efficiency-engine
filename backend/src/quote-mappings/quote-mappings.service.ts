import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { ensureIndex } from '../common/schema-maintenance';
import { QuotationEntity } from '../quotations/entities/quotation.entity';
import { QuotationItemDimensionRuleEntity } from '../quotations/entities/quotation-item-dimension-rule.entity';
import { QuotationItemEntity } from '../quotations/entities/quotation-item.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { RequirementEntity } from '../requirements/entities/requirement.entity';
import { BatchConfirmQuoteMappingsDto } from './dto/batch-confirm-quote-mappings.dto';
import { CreateQuotationItemDimensionRuleDto } from './dto/create-quotation-item-dimension-rule.dto';
import { CreateQuoteMappingDto } from './dto/create-quote-mapping.dto';
import { QuarterQuoteMappingDto } from './dto/quarter-quote-mapping.dto';
import { UpdateQuotationItemDimensionRuleDto } from './dto/update-quotation-item-dimension-rule.dto';
import { UpdateQuoteMappingDto } from './dto/update-quote-mapping.dto';

@Injectable()
export class QuoteMappingsService implements OnModuleInit {
  constructor(
    @InjectRepository(RequirementQuotationMappingEntity)
    private readonly mappingsRepository: Repository<RequirementQuotationMappingEntity>,
    @InjectRepository(RequirementItemEntity)
    private readonly requirementItemsRepository: Repository<RequirementItemEntity>,
    @InjectRepository(RequirementEntity)
    private readonly requirementsRepository: Repository<RequirementEntity>,
    @InjectRepository(QuotationEntity)
    private readonly quotationsRepository: Repository<QuotationEntity>,
    @InjectRepository(QuotationItemEntity)
    private readonly quotationItemsRepository: Repository<QuotationItemEntity>,
    @InjectRepository(QuotationItemDimensionRuleEntity)
    private readonly dimensionRulesRepository: Repository<QuotationItemDimensionRuleEntity>,
    @InjectRepository(WorklogEntity)
    private readonly worklogsRepository: Repository<WorklogEntity>,
    @InjectRepository(AiExecutionLogEntity)
    private readonly aiExecutionLogsRepository: Repository<AiExecutionLogEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureQuoteMappingsSchema();
  }

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
    const mappedIds = new Set(
      existingMappings.map((item) => item.requirement_item_id),
    );
    const pendingItems = requirementItems.filter(
      (item) => !mappedIds.has(item.id),
    );

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

  async quarterWorkbench(
    customerId: string,
    quarter: string,
    quotationId?: string,
  ) {
    if (!customerId) {
      throw new BadRequestException('customerId is required');
    }
    const context = await this.loadQuarterContext(
      customerId,
      quarter,
      quotationId,
    );
    const mappingByRequirementItemId = new Map(
      context.mappings.map((mapping) => [mapping.requirement_item_id, mapping]),
    );
    const quotationItemById = new Map(
      context.quotationItems.map((item) => [item.id, item]),
    );
    const rows = context.requirementItems.map((item) => {
      const mapping = mappingByRequirementItemId.get(item.id) ?? null;
      return {
        requirementItem: item,
        requirement: context.requirementById.get(item.requirement_id) ?? null,
        mapping,
        quotationItem: mapping?.quotation_item_id
          ? (quotationItemById.get(mapping.quotation_item_id) ?? null)
          : null,
      };
    });

    return {
      customerId,
      quarter,
      period: context.period,
      quotations: context.quotations,
      selectedQuotation: context.selectedQuotation,
      requirementItems: context.requirementItems,
      quotationItems: context.quotationItems,
      dimensionRules: context.dimensionRules,
      mappings: context.mappings,
      rows,
      summary: {
        requirementItemCount: context.requirementItems.length,
        quotationItemCount: context.quotationItems.length,
        mappedCount: rows.filter((row) => row.mapping?.quotation_item_id)
          .length,
        pendingCount: rows.filter(
          (row) => row.mapping?.mapping_status === 'pending_confirm',
        ).length,
        confirmedCount: rows.filter(
          (row) => row.mapping?.mapping_status === 'matched',
        ).length,
      },
    };
  }

  async quarterWorkbenches(customerCodes: string[], quarter: string) {
    const uniqueCustomerCodes = Array.from(
      new Set(customerCodes.map((code) => code.trim()).filter(Boolean)),
    );
    if (uniqueCustomerCodes.length === 0) {
      throw new BadRequestException('customerCodes is required');
    }
    const workbenches = await Promise.all(
      uniqueCustomerCodes.map((customerCode) =>
        this.quarterWorkbench(customerCode, quarter),
      ),
    );

    return {
      quarter,
      customerCodes: uniqueCustomerCodes,
      workbenches,
      summary: {
        customerCount: uniqueCustomerCodes.length,
        requirementItemCount: workbenches.reduce(
          (sum, item) => sum + (item.summary?.requirementItemCount ?? 0),
          0,
        ),
        quotationItemCount: workbenches.reduce(
          (sum, item) => sum + (item.summary?.quotationItemCount ?? 0),
          0,
        ),
        mappedCount: workbenches.reduce(
          (sum, item) => sum + (item.summary?.mappedCount ?? 0),
          0,
        ),
        confirmedCount: workbenches.reduce(
          (sum, item) => sum + (item.summary?.confirmedCount ?? 0),
          0,
        ),
        pendingCount: workbenches.reduce(
          (sum, item) => sum + (item.summary?.pendingCount ?? 0),
          0,
        ),
      },
    };
  }

  async quarterSuggest(dto: QuarterQuoteMappingDto) {
    const customerCode = dto.customerCode ?? dto.customerId;
    if (!customerCode) {
      throw new BadRequestException('customerCode is required');
    }
    const context = await this.loadQuarterContext(
      customerCode,
      dto.quarter,
      dto.quotationId,
    );
    if (!context.selectedQuotation) {
      throw new NotFoundException('Quarter quotation not found');
    }

    const existingByRequirementItemId = new Map(
      context.mappings.map((mapping) => [mapping.requirement_item_id, mapping]),
    );
    const targetRequirementItemIds = dto.requirementItemIds?.length
      ? new Set(dto.requirementItemIds)
      : null;
    const targetRequirementItems = targetRequirementItemIds
      ? context.requirementItems.filter((item) =>
          targetRequirementItemIds.has(item.id),
        )
      : context.requirementItems;
    const usedQuotationItemIds = new Set(
      context.mappings
        .map((mapping) => mapping.quotation_item_id)
        .filter((id): id is string => Boolean(id)),
    );
    const suggestions: RequirementQuotationMappingEntity[] = [];

    for (const item of targetRequirementItems) {
      const requirement = context.requirementById.get(item.requirement_id);
      if (!requirement) {
        continue;
      }
      const candidates = context.quotationItems
        .map((quotationItem) => ({
          quotationItem,
          score: this.scoreQuoteMapping(
            item,
            requirement,
            quotationItem,
            context.rulesByQuotationItemId.get(quotationItem.id) ?? [],
          ),
        }))
        .sort((a, b) => b.score - a.score);
      const best =
        candidates.find(
          (candidate) =>
            candidate.score >= 0.18 &&
            !usedQuotationItemIds.has(candidate.quotationItem.id),
        ) ?? candidates.find((candidate) => candidate.score >= 0.18);
      const existing = existingByRequirementItemId.get(item.id);
      const matchedRatio = best
        ? Math.min(99, Math.max(35, Math.round(best.score * 100))).toFixed(2)
        : '0.00';

      if (best) {
        usedQuotationItemIds.add(best.quotationItem.id);
      }

      const mapping =
        existing ?? this.mappingsRepository.create({ id: randomUUID() });
      Object.assign(mapping, {
        project_id: requirement.project_id,
        requirement_item_id: item.id,
        quotation_id: context.selectedQuotation.id,
        quotation_item_id: best?.quotationItem.id ?? null,
        mapping_status: best ? 'pending_confirm' : 'partial',
        mapping_type: 'ai_auto',
        matched_ratio: matchedRatio,
        remark: best
          ? `AI建议：${item.item_title} -> ${best.quotationItem.item_name}，置信度 ${matchedRatio}%`
          : `AI暂未找到可靠报价子项，请人工选择`,
      });
      const saved = await this.mappingsRepository.save(mapping);
      await this.syncRequirementQuoteScopeStatus(saved.requirement_item_id);
      await this.syncQuotationItemMatchStatus(saved.quotation_item_id);
      suggestions.push(saved);
    }

    const aiLog = this.aiExecutionLogsRepository.create({
      scene_code: 'quote_mapping',
      project_id: context.selectedQuotation.project_id,
      object_type: 'quotation',
      object_id: context.selectedQuotation.id,
      input_json: {
        customerCode,
        quarter: dto.quarter,
        quotationId: context.selectedQuotation.id,
        requirementItemCount: targetRequirementItems.length,
        quotationItemCount: context.quotationItems.length,
      },
      output_json: {
        suggestionCount: suggestions.length,
        matchedCount: suggestions.filter((item) => item.quotation_item_id)
          .length,
      },
      model_name: 'semantic-rule-matcher-v1',
      status: 'success',
      created_by: null,
    });
    await this.aiExecutionLogsRepository.save(aiLog);

    return {
      aiLogId: aiLog.id,
      suggestions,
      workbench: await this.quarterWorkbench(
        customerCode,
        dto.quarter,
        context.selectedQuotation.id,
      ),
    };
  }

  async findAll(
    projectId?: string,
    requirementItemId?: string,
    mappingStatus?: string,
  ) {
    const where = {
      ...(projectId ? { project_id: projectId } : {}),
      ...(requirementItemId ? { requirement_item_id: requirementItemId } : {}),
      ...(mappingStatus ? { mapping_status: mappingStatus } : {}),
    };
    return this.mappingsRepository.find({
      where,
      order: { created_at: 'DESC' },
      take: 1000,
    });
  }

  async create(dto: CreateQuoteMappingDto) {
    const scope = await this.validateMappingScope({
      projectId: dto.projectId,
      requirementItemId: dto.requirementItemId,
      quotationId: dto.quotationId,
      quotationItemId: dto.quotationItemId,
    });
    const existingMappings = await this.mappingsRepository.find({
      where: {
        project_id: dto.projectId,
        requirement_item_id: dto.requirementItemId,
      },
      order: { updated_at: 'DESC', created_at: 'DESC' },
    });
    const previousQuotationItemIds = new Set(
      existingMappings
        .map((mapping) => mapping.quotation_item_id)
        .filter((id): id is string => Boolean(id)),
    );
    const mapping =
      existingMappings[0] ??
      this.mappingsRepository.create({ id: randomUUID() });
    Object.assign(mapping, {
      project_id: dto.projectId,
      requirement_item_id: dto.requirementItemId,
      quotation_id: scope.quotationId,
      quotation_item_id: scope.quotationItemId,
      mapping_status: dto.mappingStatus ?? 'pending_confirm',
      mapping_type: dto.mappingType ?? 'manual',
      matched_ratio: dto.matchedRatio ?? null,
      remark: dto.remark ?? null,
    });
    const saved = await this.mappingsRepository.save(mapping);
    const obsoleteMappings = existingMappings.filter(
      (item) => item.id !== saved.id && this.isActiveQuoteMapping(item),
    );
    for (const item of obsoleteMappings) {
      item.mapping_status = 'obsolete';
      item.remark = item.remark
        ? `${item.remark}；已被新的报价选择替代`
        : '已被新的报价选择替代';
    }
    if (obsoleteMappings.length > 0) {
      await this.mappingsRepository.save(obsoleteMappings);
    }
    await this.syncRequirementQuoteScopeStatus(saved.requirement_item_id);
    await this.syncQuotationItemMatchStatuses([
      ...previousQuotationItemIds,
      saved.quotation_item_id,
    ]);
    return saved;
  }

  async findDimensionRules(quotationItemId?: string, quotationId?: string) {
    const query = this.dimensionRulesRepository
      .createQueryBuilder('rule')
      .leftJoin(
        'quotation_items',
        'quotationItem',
        'quotationItem.id = rule.quotation_item_id',
      )
      .where('rule.deleted_at IS NULL');
    if (quotationItemId) {
      query.andWhere('rule.quotation_item_id = :quotationItemId', {
        quotationItemId,
      });
    }
    if (quotationId) {
      query.andWhere('quotationItem.quotation_id = :quotationId', {
        quotationId,
      });
    }
    return query
      .orderBy('rule.priority', 'DESC')
      .addOrderBy('rule.created_at', 'DESC')
      .getMany();
  }

  async createDimensionRule(dto: CreateQuotationItemDimensionRuleDto) {
    await this.ensureQuotationItem(dto.quotationItemId);
    return this.dimensionRulesRepository.save(
      this.dimensionRulesRepository.create({
        quotation_item_id: dto.quotationItemId,
        customer_code: this.emptyToNull(dto.customerCode ?? dto.customerId),
        business_platform: this.emptyToNull(dto.businessPlatform),
        business_category: this.emptyToNull(dto.businessCategory),
        secondary_category: this.emptyToNull(dto.secondaryCategory),
        tertiary_category: this.emptyToNull(dto.tertiaryCategory),
        priority: dto.priority ?? 100,
        status: dto.status ?? 'active',
        remark: this.emptyToNull(dto.remark),
      }),
    );
  }

  async updateDimensionRule(
    id: string,
    dto: UpdateQuotationItemDimensionRuleDto,
  ) {
    const rule = await this.dimensionRulesRepository.findOne({ where: { id } });
    if (!rule) {
      throw new NotFoundException('Quotation item dimension rule not found');
    }
    if (dto.quotationItemId) {
      await this.ensureQuotationItem(dto.quotationItemId);
    }
    Object.assign(rule, {
      quotation_item_id: dto.quotationItemId ?? rule.quotation_item_id,
      customer_code:
        dto.customerCode !== undefined || dto.customerId !== undefined
          ? this.emptyToNull(dto.customerCode ?? dto.customerId)
          : rule.customer_code,
      business_platform:
        dto.businessPlatform !== undefined
          ? this.emptyToNull(dto.businessPlatform)
          : rule.business_platform,
      business_category:
        dto.businessCategory !== undefined
          ? this.emptyToNull(dto.businessCategory)
          : rule.business_category,
      secondary_category:
        dto.secondaryCategory !== undefined
          ? this.emptyToNull(dto.secondaryCategory)
          : rule.secondary_category,
      tertiary_category:
        dto.tertiaryCategory !== undefined
          ? this.emptyToNull(dto.tertiaryCategory)
          : rule.tertiary_category,
      priority: dto.priority ?? rule.priority,
      status: dto.status ?? rule.status,
      remark:
        dto.remark !== undefined ? this.emptyToNull(dto.remark) : rule.remark,
    });
    return this.dimensionRulesRepository.save(rule);
  }

  async removeDimensionRule(id: string) {
    const rule = await this.dimensionRulesRepository.findOne({ where: { id } });
    if (!rule) {
      throw new NotFoundException('Quotation item dimension rule not found');
    }
    await this.dimensionRulesRepository.softDelete(id);
    return { ruleId: id, success: true };
  }

  async update(id: string, dto: UpdateQuoteMappingDto) {
    const mapping = await this.mappingsRepository.findOne({ where: { id } });
    if (!mapping) {
      throw new NotFoundException('Quote mapping not found');
    }
    const scope = await this.validateMappingScope({
      projectId: mapping.project_id,
      requirementItemId: mapping.requirement_item_id,
      quotationId: dto.quotationId ?? mapping.quotation_id,
      quotationItemId: dto.quotationItemId ?? mapping.quotation_item_id,
    });
    const previousQuotationItemId = mapping.quotation_item_id;
    Object.assign(mapping, {
      quotation_id: scope.quotationId,
      quotation_item_id: scope.quotationItemId,
      mapping_status: dto.mappingStatus ?? mapping.mapping_status,
      mapping_type: dto.mappingType ?? mapping.mapping_type,
      matched_ratio: dto.matchedRatio ?? mapping.matched_ratio,
      remark: dto.remark ?? mapping.remark,
    });
    const saved = await this.mappingsRepository.save(mapping);
    await this.syncRequirementQuoteScopeStatus(saved.requirement_item_id);
    await this.syncQuotationItemMatchStatus(previousQuotationItemId);
    await this.syncQuotationItemMatchStatus(saved.quotation_item_id);
    return saved;
  }

  async remove(id: string) {
    const mapping = await this.mappingsRepository.findOne({ where: { id } });
    if (!mapping) {
      throw new NotFoundException('Quote mapping not found');
    }
    await this.mappingsRepository.delete(id);
    await this.syncRequirementQuoteScopeStatus(mapping.requirement_item_id);
    await this.syncQuotationItemMatchStatus(mapping.quotation_item_id);
    return { mappingId: id, success: true };
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
      partialMappings: mappings.filter(
        (item) => item.mapping_status === 'partial',
      ),
      pendingMappings: mappings.filter(
        (item) => item.mapping_status === 'pending_confirm',
      ),
    };
  }

  private async loadQuarterContext(
    customerId: string,
    quarter: string,
    quotationId?: string,
  ) {
    const period = this.parseQuarter(quarter);
    const [quarterRequirements, quotations] = await Promise.all([
      this.requirementsRepository
        .createQueryBuilder('requirement')
        .where('requirement.customer_code = :customerId', { customerId })
        .andWhere('requirement.created_at >= :startAt', {
          startAt: period.startAt,
        })
        .andWhere('requirement.created_at < :endAt', { endAt: period.endAt })
        .orderBy('requirement.created_at', 'DESC')
        .getMany(),
      this.quotationsRepository
        .createQueryBuilder('quotation')
        .where('quotation.customer_code = :customerId', { customerId })
        .andWhere(
          new Brackets((qb) => {
            qb.where(
              new Brackets((periodQb) => {
                periodQb
                  .where(
                    '(quotation.contract_start_month IS NULL OR quotation.contract_start_month <= :endMonth)',
                  )
                  .andWhere(
                    '(quotation.contract_end_month IS NULL OR quotation.contract_end_month >= :startMonth)',
                  )
                  .andWhere(
                    '(quotation.contract_start_month IS NOT NULL OR quotation.contract_end_month IS NOT NULL)',
                  );
              }),
            ).orWhere(
              new Brackets((legacyQb) => {
                legacyQb
                  .where('quotation.contract_start_month IS NULL')
                  .andWhere('quotation.contract_end_month IS NULL')
                  .andWhere('quotation.created_at >= :startAt')
                  .andWhere('quotation.created_at < :endAt');
              }),
            );
          }),
        )
        .setParameters({
          startAt: period.startAt,
          endAt: period.endAt,
          startMonth: period.startMonth,
          endMonth: period.endMonth,
        })
        .orderBy('quotation.contract_start_month', 'DESC')
        .addOrderBy('quotation.created_at', 'DESC')
        .getMany(),
    ]);
    const requirementIds = quarterRequirements.map((item) => item.id);
    const requirementItems = requirementIds.length
      ? await this.requirementItemsRepository.find({
          where: { requirement_id: In(requirementIds) },
          order: { created_at: 'ASC' },
        })
      : [];
    const selectedQuotation =
      quotations.find((item) => item.id === quotationId) ??
      quotations[0] ??
      null;
    const quotationItems = selectedQuotation
      ? await this.quotationItemsRepository.find({
          where: { quotation_id: selectedQuotation.id },
          order: { sort_order: 'ASC', created_at: 'ASC' },
          take: 500,
        })
      : [];
    const quotationItemIds = quotationItems.map((item) => item.id);
    const dimensionRules = quotationItemIds.length
      ? await this.dimensionRulesRepository.find({
          where: {
            quotation_item_id: In(quotationItemIds),
            status: 'active',
          },
          order: { priority: 'DESC', created_at: 'DESC' },
          take: 1000,
        })
      : [];
    const rulesByQuotationItemId = new Map<
      string,
      QuotationItemDimensionRuleEntity[]
    >();
    for (const rule of dimensionRules) {
      const current = rulesByQuotationItemId.get(rule.quotation_item_id) ?? [];
      current.push(rule);
      rulesByQuotationItemId.set(rule.quotation_item_id, current);
    }
    const requirementItemIds = requirementItems.map((item) => item.id);
    const mappings = requirementItemIds.length
      ? await this.mappingsRepository.find({
          where: {
            requirement_item_id: In(requirementItemIds),
            ...(selectedQuotation
              ? { quotation_id: selectedQuotation.id }
              : {}),
          },
          order: { created_at: 'DESC' },
        })
      : [];

    return {
      customerId,
      quarter,
      period,
      requirements: quarterRequirements,
      requirementById: new Map(
        quarterRequirements.map((requirement) => [requirement.id, requirement]),
      ),
      requirementItems,
      quotations,
      selectedQuotation,
      quotationItems,
      dimensionRules,
      rulesByQuotationItemId,
      mappings,
    };
  }

  private async ensureQuotationItem(id: string) {
    const item = await this.quotationItemsRepository.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException('Quotation item not found');
    }
    return item;
  }

  private emptyToNull(value?: string | null) {
    const trimmed = String(value ?? '').trim();
    return trimmed ? trimmed : null;
  }

  private async syncRequirementQuoteScopeStatus(requirementItemId: string) {
    const item = await this.requirementItemsRepository.findOne({
      where: { id: requirementItemId },
    });
    if (!item) {
      return;
    }
    const mappings = await this.mappingsRepository.find({
      where: { requirement_item_id: requirementItemId },
    });
    item.quote_scope_status = this.resolveQuoteScopeStatus(mappings);
    await this.requirementItemsRepository.save(item);
  }

  private async syncQuotationItemMatchStatus(quotationItemId: string | null) {
    if (!quotationItemId) {
      return;
    }
    const item = await this.quotationItemsRepository.findOne({
      where: { id: quotationItemId },
    });
    if (!item) {
      return;
    }
    const mappings = await this.mappingsRepository.find({
      where: { quotation_item_id: quotationItemId },
    });
    const activeMappings = mappings.filter((mapping) =>
      this.isActiveQuoteMapping(mapping),
    );
    if (
      activeMappings.some((mapping) => mapping.mapping_status === 'matched')
    ) {
      item.match_status = 'confirmed';
    } else if (activeMappings.length > 0) {
      item.match_status = 'matched';
    } else {
      item.match_status =
        Number(item.line_amount || 0) > 0 ? 'unmatched' : 'price_missing';
    }
    await this.quotationItemsRepository.save(item);
  }

  private async syncQuotationItemMatchStatuses(
    quotationItemIds: Array<string | null>,
  ) {
    const uniqueIds = Array.from(
      new Set(quotationItemIds.filter((id): id is string => Boolean(id))),
    );
    for (const quotationItemId of uniqueIds) {
      await this.syncQuotationItemMatchStatus(quotationItemId);
    }
  }

  private async validateMappingScope(input: {
    projectId: string;
    requirementItemId: string;
    quotationId?: string | null;
    quotationItemId?: string | null;
  }) {
    const requirementItem = await this.requirementItemsRepository.findOne({
      where: { id: input.requirementItemId },
    });
    if (!requirementItem) {
      throw new NotFoundException('Requirement item not found');
    }
    const requirement = await this.requirementsRepository.findOne({
      where: { id: requirementItem.requirement_id },
    });
    if (!requirement) {
      throw new NotFoundException('Requirement not found');
    }
    if (requirement.project_id !== input.projectId) {
      throw new BadRequestException(
        'Requirement item does not belong to project',
      );
    }

    let quotationItem: QuotationItemEntity | null = null;
    if (input.quotationItemId) {
      quotationItem = await this.quotationItemsRepository.findOne({
        where: { id: input.quotationItemId },
      });
      if (!quotationItem) {
        throw new NotFoundException('Quotation item not found');
      }
    }

    const quotationId =
      input.quotationId ?? quotationItem?.quotation_id ?? null;
    let quotation: QuotationEntity | null = null;
    if (quotationId) {
      quotation = await this.quotationsRepository.findOne({
        where: { id: quotationId },
      });
      if (!quotation) {
        throw new NotFoundException('Quotation not found');
      }
    }

    if (
      quotationItem &&
      quotationId &&
      quotationItem.quotation_id !== quotationId
    ) {
      throw new BadRequestException(
        'Quotation item does not belong to quotation',
      );
    }
    if (quotation && quotation.customer_code !== requirement.customer_code) {
      throw new BadRequestException(
        'Quotation customer does not match requirement customer',
      );
    }

    return {
      quotationId,
      quotationItemId: quotationItem?.id ?? input.quotationItemId ?? null,
    };
  }

  private isActiveQuoteMapping(mapping: RequirementQuotationMappingEntity) {
    return !['rejected', 'obsolete'].includes(mapping.mapping_status);
  }

  private resolveQuoteScopeStatus(
    mappings: RequirementQuotationMappingEntity[],
  ) {
    const activeMappings = mappings.filter((mapping) =>
      this.isActiveQuoteMapping(mapping),
    );
    if (activeMappings.length === 0) {
      return 'not_started';
    }
    if (
      activeMappings.some((mapping) => mapping.mapping_status === 'matched')
    ) {
      return 'matched';
    }
    if (
      activeMappings.some(
        (mapping) =>
          mapping.mapping_status === 'pending_confirm' &&
          mapping.quotation_item_id,
      )
    ) {
      return 'pending_confirm';
    }
    if (
      activeMappings.some((mapping) => mapping.mapping_status === 'partial')
    ) {
      return 'partial';
    }
    return 'changed';
  }

  private async ensureQuoteMappingsSchema() {
    await ensureIndex(
      this.dataSource,
      'requirement_quotation_mappings',
      'idx_quote_mappings_requirement_created',
      ['requirement_item_id', 'created_at'],
    );
    await ensureIndex(
      this.dataSource,
      'requirement_quotation_mappings',
      'idx_quote_mappings_project_status',
      ['project_id', 'mapping_status'],
    );
    await ensureIndex(
      this.dataSource,
      'requirement_quotation_mappings',
      'idx_quote_mappings_quotation_item_status',
      ['quotation_item_id', 'mapping_status'],
    );
  }

  private parseQuarter(quarter: string) {
    const match = /^(\d{4})-?Q([1-4])$/i.exec(String(quarter || '').trim());
    if (!match) {
      throw new BadRequestException('quarter must be formatted as YYYY-Qn');
    }
    const year = Number(match[1]);
    const quarterNo = Number(match[2]);
    const startAt = new Date(year, (quarterNo - 1) * 3, 1, 0, 0, 0, 0);
    const endAt = new Date(year, quarterNo * 3, 1, 0, 0, 0, 0);
    const startMonth = `${year}-${String((quarterNo - 1) * 3 + 1).padStart(
      2,
      '0',
    )}`;
    const endMonth = `${year}-${String(quarterNo * 3).padStart(2, '0')}`;
    return {
      quarter: `${year}-Q${quarterNo}`,
      startAt,
      endAt,
      startMonth,
      endMonth,
      label: `${year}年第${quarterNo}季度`,
    };
  }

  private scoreQuoteMapping(
    requirementItem: RequirementItemEntity,
    requirement: RequirementEntity,
    quotationItem: QuotationItemEntity,
    rules: QuotationItemDimensionRuleEntity[] = [],
  ) {
    const requirementText = [
      requirementItem.item_title,
      requirementItem.item_description,
      requirementItem.business_goal,
    ].join(' ');
    const quotationText = [quotationItem.item_name, quotationItem.remark].join(
      ' ',
    );
    const requirementTokens = this.textTokens(requirementText);
    const quotationTokens = this.textTokens(quotationText);
    const dimensionScore = this.scoreDimensionRules(requirement, rules);
    if (requirementTokens.size === 0 || quotationTokens.size === 0) {
      return dimensionScore;
    }

    const intersection = [...requirementTokens].filter((token) =>
      quotationTokens.has(token),
    ).length;
    const union = new Set([...requirementTokens, ...quotationTokens]).size;
    const keywordBoost = this.serviceKeywordScore(
      requirementText,
      quotationText,
    );
    const textScore = intersection / union + keywordBoost;
    return Math.min(1, Math.max(textScore, dimensionScore + textScore * 0.2));
  }

  private scoreDimensionRules(
    requirement: RequirementEntity,
    rules: QuotationItemDimensionRuleEntity[],
  ) {
    if (!rules.length) {
      return 0;
    }
    const snapshot = {
      customer_code: requirement.customer_code,
      business_platform: requirement.business_platform,
      business_category: requirement.business_category,
      secondary_category: requirement.secondary_category,
      tertiary_category: requirement.tertiary_category,
    };
    const weights = {
      customer_code: 0.15,
      business_platform: 0.15,
      business_category: 0.25,
      secondary_category: 0.25,
      tertiary_category: 0.3,
    };
    return rules.reduce((bestScore, rule) => {
      let score = 0.18;
      let specified = 0;
      for (const key of Object.keys(weights) as Array<keyof typeof weights>) {
        const ruleValue = this.normalizeDimensionValue(rule[key]);
        if (!ruleValue) {
          continue;
        }
        specified += 1;
        const requirementValue = this.normalizeDimensionValue(snapshot[key]);
        if (requirementValue !== ruleValue) {
          return bestScore;
        }
        score += weights[key];
      }
      if (specified === 0) {
        return bestScore;
      }
      score += Math.min(0.07, Math.max(0, rule.priority || 0) / 2000);
      return Math.max(bestScore, Math.min(1, score));
    }, 0);
  }

  private normalizeDimensionValue(value?: string | null) {
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  private textTokens(value: string) {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ')
      .trim();
    const tokens = new Set<string>();
    for (const token of normalized.split(/\s+/g).filter(Boolean)) {
      tokens.add(token);
      if (/[\p{Script=Han}]/u.test(token)) {
        for (let index = 0; index < token.length - 1; index += 1) {
          tokens.add(token.slice(index, index + 2));
        }
      }
    }
    return tokens;
  }

  private serviceKeywordScore(requirementText: string, quotationText: string) {
    const keywordGroups = [
      ['月报', '季报', '年报', '报告', '定期报告'],
      ['长图', '海报', 'banner', 'kv', '设计', '物料'],
      ['文案', '撰写', '推文', 'word', '材料'],
      ['投教', '专题', '活动页', '官网', '运营'],
      ['数据', '披露', '核对', '净值', '持仓', '业绩'],
      ['合规', '审核', '免责声明', '留痕'],
    ];
    const left = requirementText.toLowerCase();
    const right = quotationText.toLowerCase();
    return keywordGroups.reduce((score, group) => {
      const leftHit = group.some((keyword) => left.includes(keyword));
      const rightHit = group.some((keyword) => right.includes(keyword));
      return score + (leftHit && rightHit ? 0.16 : 0);
    }, 0);
  }
}
