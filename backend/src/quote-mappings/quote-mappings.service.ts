import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { QuotationEntity } from '../quotations/entities/quotation.entity';
import { QuotationItemEntity } from '../quotations/entities/quotation-item.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { RequirementEntity } from '../requirements/entities/requirement.entity';
import { BatchConfirmQuoteMappingsDto } from './dto/batch-confirm-quote-mappings.dto';
import { CreateQuoteMappingDto } from './dto/create-quote-mapping.dto';
import { QuarterQuoteMappingDto } from './dto/quarter-quote-mapping.dto';
import { UpdateQuoteMappingDto } from './dto/update-quote-mapping.dto';

@Injectable()
export class QuoteMappingsService {
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

  async quarterWorkbenches(customerIds: string[], quarter: string) {
    const uniqueCustomerIds = Array.from(
      new Set(customerIds.map((id) => id.trim()).filter(Boolean)),
    );
    if (uniqueCustomerIds.length === 0) {
      throw new BadRequestException('customerIds is required');
    }
    const workbenches = await Promise.all(
      uniqueCustomerIds.map((customerId) =>
        this.quarterWorkbench(customerId, quarter),
      ),
    );

    return {
      quarter,
      customerIds: uniqueCustomerIds,
      workbenches,
      summary: {
        customerCount: uniqueCustomerIds.length,
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
    const context = await this.loadQuarterContext(
      dto.customerId,
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
          score: this.scoreQuoteMapping(item, quotationItem),
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
        customerId: dto.customerId,
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
        dto.customerId,
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
    const saved = await this.mappingsRepository.save(mapping);
    await this.syncRequirementQuoteScopeStatus(saved.requirement_item_id);
    await this.syncQuotationItemMatchStatus(saved.quotation_item_id);
    return saved;
  }

  async update(id: string, dto: UpdateQuoteMappingDto) {
    const mapping = await this.mappingsRepository.findOne({ where: { id } });
    if (!mapping) {
      throw new NotFoundException('Quote mapping not found');
    }
    const previousQuotationItemId = mapping.quotation_item_id;
    Object.assign(mapping, {
      quotation_id: dto.quotationId ?? mapping.quotation_id,
      quotation_item_id: dto.quotationItemId ?? mapping.quotation_item_id,
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
    const [requirements, quotations] = await Promise.all([
      this.requirementsRepository.find({
        where: { customer_id: customerId },
        order: { created_at: 'DESC' },
        take: 500,
      }),
      this.quotationsRepository
        .createQueryBuilder('quotation')
        .where('quotation.customer_id = :customerId', { customerId })
        .andWhere('quotation.created_at >= :startAt', {
          startAt: period.startAt,
        })
        .andWhere('quotation.created_at < :endAt', { endAt: period.endAt })
        .orderBy('quotation.created_at', 'DESC')
        .getMany(),
    ]);
    const quarterRequirements = requirements.filter(
      (requirement) =>
        requirement.created_at >= period.startAt &&
        requirement.created_at < period.endAt,
    );
    const requirementIds = quarterRequirements.map((item) => item.id);
    const requirementItems = requirementIds.length
      ? await this.requirementItemsRepository.find({
          where: { requirement_id: In(requirementIds) },
          order: { created_at: 'ASC' },
          take: 500,
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
          take: 500,
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
      mappings,
    };
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
    if (mappings.some((mapping) => mapping.mapping_status === 'matched')) {
      item.match_status = 'confirmed';
    } else if (mappings.length > 0) {
      item.match_status = 'matched';
    } else {
      item.match_status =
        Number(item.line_amount || 0) > 0 ? 'unmatched' : 'price_missing';
    }
    await this.quotationItemsRepository.save(item);
  }

  private resolveQuoteScopeStatus(
    mappings: RequirementQuotationMappingEntity[],
  ) {
    if (mappings.length === 0) {
      return 'not_started';
    }
    if (mappings.some((mapping) => mapping.mapping_status === 'matched')) {
      return 'matched';
    }
    if (
      mappings.some(
        (mapping) =>
          mapping.mapping_status === 'pending_confirm' &&
          mapping.quotation_item_id,
      )
    ) {
      return 'pending_confirm';
    }
    if (mappings.some((mapping) => mapping.mapping_status === 'partial')) {
      return 'partial';
    }
    return 'changed';
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
    return {
      quarter: `${year}-Q${quarterNo}`,
      startAt,
      endAt,
      label: `${year}年第${quarterNo}季度`,
    };
  }

  private scoreQuoteMapping(
    requirementItem: RequirementItemEntity,
    quotationItem: QuotationItemEntity,
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
    if (requirementTokens.size === 0 || quotationTokens.size === 0) {
      return 0;
    }

    const intersection = [...requirementTokens].filter((token) =>
      quotationTokens.has(token),
    ).length;
    const union = new Set([...requirementTokens, ...quotationTokens]).size;
    const keywordBoost = this.serviceKeywordScore(
      requirementText,
      quotationText,
    );
    return Math.min(1, intersection / union + keywordBoost);
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
