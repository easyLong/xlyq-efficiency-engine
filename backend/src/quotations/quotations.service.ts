import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { CreateQuotationItemDto } from './dto/create-quotation-item.dto';
import { ImportQuotationTextDto } from './dto/import-quotation-text.dto';
import { ParseQuotationTextDto } from './dto/parse-quotation-text.dto';
import { ReviewQuotationDto } from './dto/review-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { UpdateQuotationItemDto } from './dto/update-quotation-item.dto';
import { QuotationItemDimensionRuleEntity } from './entities/quotation-item-dimension-rule.entity';
import { QuotationItemEntity } from './entities/quotation-item.entity';
import { QuotationEntity } from './entities/quotation.entity';
import { RequirementQuotationMappingEntity } from './entities/requirement-quotation-mapping.entity';

@Injectable()
export class QuotationsService {
  private readonly defaultListLimit = 500;
  private readonly maxParsedQuotationItems = 500;
  private readonly maxModelQuotationContentLength = 60000;

  constructor(
    @InjectRepository(QuotationEntity)
    private readonly quotationsRepository: Repository<QuotationEntity>,
    @InjectRepository(QuotationItemEntity)
    private readonly quotationItemsRepository: Repository<QuotationItemEntity>,
    @InjectRepository(AiExecutionLogEntity)
    private readonly aiExecutionLogsRepository: Repository<AiExecutionLogEntity>,
    @InjectRepository(QuotationItemDimensionRuleEntity)
    private readonly dimensionRulesRepository: Repository<QuotationItemDimensionRuleEntity>,
    @InjectRepository(RequirementQuotationMappingEntity)
    private readonly mappingsRepository: Repository<RequirementQuotationMappingEntity>,
    @InjectRepository(RequirementItemEntity)
    private readonly requirementItemsRepository: Repository<RequirementItemEntity>,
  ) {}

  async findAll(projectId?: string, status?: string) {
    const where = {
      ...(projectId ? { project_id: projectId } : {}),
      ...(status ? { status } : {}),
    };

    return this.quotationsRepository.find({
      where,
      order: { created_at: 'DESC' },
      take: this.defaultListLimit,
    });
  }

  async findOne(id: string) {
    const quotation = await this.quotationsRepository.findOne({
      where: { id },
    });
    if (!quotation) {
      throw new NotFoundException('Quotation not found');
    }
    return quotation;
  }

  async create(dto: CreateQuotationDto) {
    const quotation = this.quotationsRepository.create({
      id: randomUUID(),
      quotation_no: dto.quotationNo ?? (await this.nextQuotationNo()),
      project_id: dto.projectId,
      customer_id: dto.customerId,
      status: dto.status ?? 'draft',
      pricing_basis: dto.pricingBasis ?? 'manual',
      total_amount: '0.00',
      version_no: 1,
      remark: dto.remark ?? null,
    });

    return this.quotationsRepository.save(quotation);
  }

  async update(id: string, dto: UpdateQuotationDto) {
    const quotation = await this.findOne(id);
    Object.assign(quotation, {
      status: dto.status ?? quotation.status,
      pricing_basis: dto.pricingBasis ?? quotation.pricing_basis,
      remark: dto.remark ?? quotation.remark,
    });
    return this.quotationsRepository.save(quotation);
  }

  async listItems(quotationId: string) {
    await this.findOne(quotationId);
    return this.quotationItemsRepository.find({
      where: { quotation_id: quotationId },
      order: { created_at: 'ASC' },
    });
  }

  async addItem(quotationId: string, dto: CreateQuotationItemDto) {
    await this.findOne(quotationId);
    const quantity = Number(dto.quantity ?? '1');
    const unitPrice = Number(dto.unitPrice ?? '0');
    const item = this.quotationItemsRepository.create({
      id: randomUUID(),
      quotation_id: quotationId,
      item_code: dto.itemCode ?? (await this.nextItemCode(quotationId)),
      item_name: dto.itemName,
      pricing_mode: dto.pricingMode ?? 'fixed',
      quantity: quantity.toFixed(2),
      unit: dto.unit ?? null,
      unit_price: unitPrice.toFixed(2),
      line_amount: (quantity * unitPrice).toFixed(2),
      source: dto.source ?? 'manual',
      match_status: dto.matchStatus ?? 'manual_added',
      remark: dto.remark ?? null,
      sort_order: await this.nextItemSortOrder(quotationId),
    });
    const saved = await this.quotationItemsRepository.save(item);
    await this.recalculateTotal(quotationId);
    return saved;
  }

  async importText(dto: ImportQuotationTextDto) {
    const parsed = await this.parseQuotationTextWithModel(
      dto.rawContent,
      dto.fileName,
    );
    if (parsed.items.length === 0) {
      throw new BadRequestException('No quotation item found');
    }

    const quotation = await this.create({
      projectId: dto.projectId,
      customerId: dto.customerId,
      pricingBasis: dto.pricingBasis ?? 'uploaded_text',
      status: 'draft',
      remark:
        dto.remark ??
        `由${dto.fileName ? `文件「${dto.fileName}」` : '粘贴内容'}解析生成`,
    });

    const items = await this.quotationItemsRepository.save(
      parsed.items.map((item, index) =>
        this.quotationItemsRepository.create({
          id: randomUUID(),
          quotation_id: quotation.id,
          item_code: `ITEM-${String(index + 1).padStart(3, '0')}`,
          item_name: item.itemName,
          pricing_mode: item.pricingMode,
          quantity: item.quantity.toFixed(2),
          unit: item.unit,
          unit_price: item.unitPrice.toFixed(2),
          line_amount: item.lineAmount.toFixed(2),
          source: 'uploaded_text',
          match_status: item.lineAmount > 0 ? 'unmatched' : 'price_missing',
          remark: item.remark,
          sort_order: index + 1,
        }),
      ),
    );
    await this.recalculateTotal(quotation.id);

    return {
      quotation: await this.findOne(quotation.id),
      items,
      parsedCount: items.length,
      summary: parsed.summary,
      ignoredLines: parsed.ignoredLines,
      mode: parsed.mode,
      modelName: parsed.modelName,
      ruleItemCount: parsed.ruleItemCount,
      modelItemCount: parsed.modelItemCount,
      modelError: parsed.modelError,
      aiLogId: parsed.aiLogId,
      source: dto.fileName ?? 'manual_paste',
    };
  }

  async parseText(dto: ParseQuotationTextDto) {
    const parsed = await this.parseQuotationTextWithModel(
      dto.rawContent,
      dto.fileName,
    );
    return {
      ...parsed,
      source: dto.fileName ?? 'manual_paste',
    };
  }

  async updateItem(itemId: string, dto: UpdateQuotationItemDto) {
    const item = await this.quotationItemsRepository.findOne({
      where: { id: itemId },
    });
    if (!item) {
      throw new NotFoundException('Quotation item not found');
    }
    const quantity = Number(dto.quantity ?? item.quantity);
    const unitPrice = Number(dto.unitPrice ?? item.unit_price);
    Object.assign(item, {
      item_name: dto.itemName ?? item.item_name,
      pricing_mode: dto.pricingMode ?? item.pricing_mode,
      quantity: quantity.toFixed(2),
      unit: dto.unit ?? item.unit,
      unit_price: unitPrice.toFixed(2),
      line_amount: (quantity * unitPrice).toFixed(2),
      source: dto.source ?? item.source,
      match_status: dto.matchStatus ?? item.match_status,
      remark: dto.remark ?? item.remark,
    });
    const saved = await this.quotationItemsRepository.save(item);
    await this.recalculateTotal(item.quotation_id);
    return saved;
  }

  async deleteItem(itemId: string) {
    const item = await this.quotationItemsRepository.findOne({
      where: { id: itemId },
    });
    if (!item) {
      throw new NotFoundException('Quotation item not found');
    }
    const affectedRequirementItemIds =
      await this.deleteMappingsForQuotationItems([itemId]);
    await this.dimensionRulesRepository.softDelete({
      quotation_item_id: itemId,
    });
    await this.quotationItemsRepository.softDelete(itemId);
    await this.recalculateTotal(item.quotation_id);
    await this.syncRequirementQuoteScopeStatuses(affectedRequirementItemIds);
    return {
      success: true,
      clearedMappingRequirementItemCount: affectedRequirementItemIds.length,
    };
  }

  async remove(id: string) {
    await this.findOne(id);
    const items = await this.quotationItemsRepository.find({
      where: { quotation_id: id },
    });
    const itemIds = items.map((item) => item.id);
    if (itemIds.length > 0) {
      await this.dimensionRulesRepository.softDelete({
        quotation_item_id: In(itemIds),
      });
      await this.quotationItemsRepository.softDelete({ id: In(itemIds) });
    }
    const affectedRequirementItemIds =
      await this.deleteMappingsForQuotation(id, itemIds);
    await this.quotationsRepository.softDelete(id);
    await this.syncRequirementQuoteScopeStatuses(affectedRequirementItemIds);
    return {
      quotationId: id,
      deletedItemCount: itemIds.length,
      clearedMappingRequirementItemCount: affectedRequirementItemIds.length,
    };
  }

  async submitReview(id: string) {
    return this.update(id, { status: 'pending_review' });
  }

  async review(id: string, dto: ReviewQuotationDto) {
    return this.update(id, {
      status: dto.approved ? 'pending_customer_confirm' : 'rejected',
      remark: dto.remark,
    });
  }

  async confirmCustomer(id: string) {
    const quotation = await this.findOne(id);
    quotation.status = 'confirmed';
    quotation.confirmed_at = new Date();
    return this.quotationsRepository.save(quotation);
  }

  async export(id: string) {
    const quotation = await this.findOne(id);
    const items = await this.listItems(id);
    return {
      quotation,
      items,
      exportedAt: new Date().toISOString(),
      format: 'json-preview',
    };
  }

  private async recalculateTotal(quotationId: string) {
    const raw = await this.quotationItemsRepository
      .createQueryBuilder('qi')
      .select('COALESCE(SUM(qi.line_amount), 0)', 'total')
      .where('qi.quotation_id = :quotationId', { quotationId })
      .getRawOne<{ total: string }>();

    const quotation = await this.findOne(quotationId);
    quotation.total_amount = Number(raw?.total ?? 0).toFixed(2);
    await this.quotationsRepository.save(quotation);
  }

  private async deleteMappingsForQuotation(
    quotationId: string,
    quotationItemIds: string[],
  ) {
    const query = this.mappingsRepository
      .createQueryBuilder('mapping')
      .where('mapping.quotation_id = :quotationId', { quotationId });
    if (quotationItemIds.length > 0) {
      query.orWhere('mapping.quotation_item_id IN (:...quotationItemIds)', {
        quotationItemIds,
      });
    }
    const mappings = await query.getMany();
    if (mappings.length === 0) {
      return [];
    }
    await this.mappingsRepository.delete({
      id: In(mappings.map((mapping) => mapping.id)),
    });
    return this.uniqueRequirementItemIds(mappings);
  }

  private async deleteMappingsForQuotationItems(quotationItemIds: string[]) {
    if (quotationItemIds.length === 0) {
      return [];
    }
    const mappings = await this.mappingsRepository.find({
      where: { quotation_item_id: In(quotationItemIds) },
    });
    if (mappings.length === 0) {
      return [];
    }
    await this.mappingsRepository.delete({
      id: In(mappings.map((mapping) => mapping.id)),
    });
    return this.uniqueRequirementItemIds(mappings);
  }

  private uniqueRequirementItemIds(
    mappings: RequirementQuotationMappingEntity[],
  ) {
    return Array.from(
      new Set(mappings.map((mapping) => mapping.requirement_item_id)),
    );
  }

  private async syncRequirementQuoteScopeStatuses(requirementItemIds: string[]) {
    for (const requirementItemId of requirementItemIds) {
      const item = await this.requirementItemsRepository.findOne({
        where: { id: requirementItemId },
      });
      if (!item) {
        continue;
      }
      const mappings = await this.mappingsRepository.find({
        where: { requirement_item_id: requirementItemId },
      });
      item.quote_scope_status = this.resolveQuoteScopeStatus(mappings);
      await this.requirementItemsRepository.save(item);
    }
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

  private async nextItemCode(quotationId: string) {
    const rows = await this.quotationItemsRepository
      .createQueryBuilder('item')
      .withDeleted()
      .select('item.item_code', 'itemCode')
      .where('item.quotation_id = :quotationId', { quotationId })
      .getRawMany<{ itemCode: string }>();
    const maxNo = rows.reduce((max, row) => {
      const match = /^ITEM-(\d+)$/.exec(row.itemCode ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `ITEM-${String(maxNo + 1).padStart(3, '0')}`;
  }

  private async nextQuotationNo() {
    const prefix = `QT-${this.todayStamp()}-`;
    const rows = await this.quotationsRepository
      .createQueryBuilder('quotation')
      .withDeleted()
      .select('quotation.quotation_no', 'quotationNo')
      .where('quotation.quotation_no LIKE :prefix', { prefix: `${prefix}%` })
      .getRawMany<{ quotationNo: string }>();
    const maxNo = rows.reduce((max, row) => {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(row.quotationNo ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `${prefix}${String(maxNo + 1).padStart(4, '0')}`;
  }

  private todayStamp() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  }

  private async nextItemSortOrder(quotationId: string) {
    const raw = await this.quotationItemsRepository
      .createQueryBuilder('item')
      .withDeleted()
      .select('COALESCE(MAX(item.sort_order), 0)', 'maxOrder')
      .where('item.quotation_id = :quotationId', { quotationId })
      .getRawOne<{ maxOrder: string }>();
    return Number(raw?.maxOrder ?? 0) + 1;
  }

  private async parseQuotationTextWithModel(
    rawContent: string,
    fileName?: string,
  ) {
    const startedAt = Date.now();
    const ruleParsed = this.parseQuotationText(rawContent);
    const modelName = process.env.OPENAI_MODEL?.trim();
    const input = {
      fileName: fileName ?? null,
      rawLength: rawContent.length,
      ruleItemCount: ruleParsed.items.length,
    };

    if (
      !process.env.OPENAI_BASE_URL?.trim() ||
      !process.env.OPENAI_API_KEY?.trim() ||
      !modelName
    ) {
      const result = {
        ...ruleParsed,
        mode: 'rule_fallback',
        modelName: 'local-quotation-parser-v1',
        ruleItemCount: ruleParsed.items.length,
        modelItemCount: 0,
        modelError: null,
      };
      const aiLogId = await this.logQuotationParse({
        input,
        output: this.quotationParseLogOutput(result),
        modelName: result.modelName,
        status: 'success',
        executionMs: Date.now() - startedAt,
        errorMessage: null,
      });
      return { ...result, aiLogId };
    }

    try {
      const modelItems = await this.callOpenAiCompatibleQuotationParser(
        rawContent,
        modelName,
      );
      const items = this.mergeQuotationParsedItems(
        ruleParsed.items,
        modelItems,
      );
      const result = {
        items,
        ignoredLines: ruleParsed.ignoredLines,
        summary: this.buildQuotationSummary(items),
        mode: 'openai_compatible',
        modelName,
        ruleItemCount: ruleParsed.items.length,
        modelItemCount: modelItems.length,
        modelError: null,
      };
      const aiLogId = await this.logQuotationParse({
        input,
        output: this.quotationParseLogOutput(result),
        modelName,
        status: 'success',
        executionMs: Date.now() - startedAt,
        errorMessage: null,
      });
      return { ...result, aiLogId };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown model error';
      const result = {
        ...ruleParsed,
        mode: 'openai_failed_rule_fallback',
        modelName,
        ruleItemCount: ruleParsed.items.length,
        modelItemCount: 0,
        modelError: message,
      };
      const aiLogId = await this.logQuotationParse({
        input,
        output: this.quotationParseLogOutput(result),
        modelName,
        status: 'fallback',
        executionMs: Date.now() - startedAt,
        errorMessage: message,
      });
      return { ...result, aiLogId };
    }
  }

  private async callOpenAiCompatibleQuotationParser(
    rawContent: string,
    modelName: string,
  ) {
    const response = await fetch(this.openAiChatCompletionsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是报价单结构化解析助手。',
              '只提取报价服务明细，不要提取标题、表头、合计、小计、税费说明、付款说明、备注说明。',
              '一级目录、二级目录、章节标题只作为 hierarchyPath 的上级层级，绝对不要单独输出成 item。',
              '像“### 一、平台运营服务”“三、线上物料设计”“设计服务”这种目录行不能作为报价子项。',
              '必须逐行识别报价合同里所有带单价/报价/金额的服务明细行，不能只抽样，不能合并成大项，不能遗漏低价或重复平台的行。',
              'Markdown 表格、CSV、制表符表格中，每一行只要有服务名称和单价，就必须输出一个 item；表头和分隔线不输出。',
              '报价子项的 title 必须是报价单层级关系的拼接，例如“设计 > 长图服务 > 长图新设计”；contentDescription 只填写最末级子项描述。',
              '如果报价单存在章节、一级分类、二级分类、服务项等层级，hierarchyPath 填层级数组，title 用这些层级拼接。',
              '优先按表格行提取，合并重复项；如果一个合并项明显包含多个服务子项，可以拆成多个 item，拆分后的 title 仍要保留上级层级。',
              '金额单位如果是万元，必须换算成人民币元。',
              '如果表格中只有“单价”列，没有“金额/小计”列，lineAmount 填单价，quantity 填 1。',
              '无法确定数量时填 1；无法确定金额时填 0。',
              '只输出 JSON，不要输出 Markdown。',
              'JSON 格式：{"items":[{"title":"层级拼接后的子项title，不超过128字","contentDescription":"最末级子项描述","hierarchyPath":["一级","二级","子项"],"quantity":数字,"unit":"项/张/篇/期/次等","unitPrice":数字,"lineAmount":数字,"pricingMode":"fixed","remark":"原始依据"}]}',
              `最多输出 ${this.maxParsedQuotationItems} 条。`,
            ].join('\n'),
          },
          {
            role: 'user',
            content: rawContent.slice(0, this.maxModelQuotationContentLength),
          },
        ],
      }),
    });

    const body = (await response.json()) as {
      error?: { message?: string };
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    if (!response.ok) {
      throw new Error(
        `OpenAI compatible quotation parse failed: ${response.status} ${body.error?.message ?? ''}`,
      );
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI compatible quotation response missing content');
    }

    return this.normalizeModelQuotationItems(this.parseJsonObject(content));
  }

  private normalizeModelQuotationItems(input: unknown) {
    const items = Array.isArray((input as { items?: unknown[] })?.items)
      ? (input as { items: unknown[] }).items
      : [];
    return items
      .map((item) => item as Record<string, unknown>)
      .map((item): ParsedQuotationItem | null => {
        const hierarchyPath = this.normalizeHierarchyPath(
          item.hierarchyPath ?? item.hierarchy ?? item.path,
        );
        const description = this.compactDescription(
          String(
            item.contentDescription ??
              item.itemDescription ??
              item.description ??
              item.remark ??
              '',
          ),
        );
        const rawTitle = String(
          item.title ?? item.itemTitle ?? item.itemName ?? description,
        );
        const itemName = this.composeQuotationItemTitle(
          hierarchyPath,
          rawTitle,
          description,
        );
        if (
          !itemName ||
          this.isQuotationNoiseLine(itemName) ||
          this.isDirectoryOnlyQuotationItem(itemName, description, item)
        ) {
          return null;
        }
        const remark = description || String(item.remark ?? itemName).trim();
        const quantity = this.normalizePositiveNumber(item.quantity, 1);
        const unitPrice = this.normalizeMoneyNumber(item.unitPrice);
        const rawLineAmount = this.normalizeMoneyNumber(item.lineAmount);
        const lineAmount =
          rawLineAmount > 0
            ? rawLineAmount
            : Number((quantity * unitPrice).toFixed(2));
        if (
          lineAmount <= 0 &&
          unitPrice <= 0 &&
          !this.isExplicitZeroPriceQuotation(`${rawTitle} ${description}`)
        ) {
          return null;
        }
        return {
          itemName,
          pricingMode: 'fixed',
          quantity,
          unit:
            String(item.unit ?? '').trim().slice(0, 16) ||
            this.guessUnit(`${itemName} ${remark}`),
          unitPrice:
            unitPrice > 0
              ? unitPrice
              : quantity > 0
                ? Number((lineAmount / quantity).toFixed(2))
                : lineAmount,
          lineAmount,
          remark: remark ? `子项描述：${remark.slice(0, 240)}` : '',
          category: null,
          source: 'model',
        };
      })
      .filter((item): item is ParsedQuotationItem => Boolean(item))
      .slice(0, this.maxParsedQuotationItems);
  }

  private mergeQuotationParsedItems(
    ruleItems: ParsedQuotationItem[],
    modelItems: ParsedQuotationItem[],
  ) {
    const merged = new Map<string, ParsedQuotationItem>();
    const upsert = (item: ParsedQuotationItem) => {
      const key = this.quotationItemMergeKey(item);
      const existing = merged.get(key);
      if (!existing) {
        if (
          item.source !== 'model' &&
          this.isCoveredByExistingModelItem(item, [...merged.values()])
        ) {
          return;
        }
        merged.set(key, item);
        return;
      }

      const existingPriced = existing.lineAmount > 0 || existing.unitPrice > 0;
      const incomingPriced = item.lineAmount > 0 || item.unitPrice > 0;
      if (incomingPriced && !existingPriced) {
        merged.set(key, {
          ...item,
          remark: `${existing.remark || ''}${existing.remark ? '；' : ''}${item.remark}`,
        });
        return;
      }

      if (
        incomingPriced &&
        existingPriced &&
        item.source === 'model' &&
        existing.source !== 'model'
      ) {
        merged.set(key, {
          ...existing,
          quantity: item.quantity || existing.quantity,
          unit: item.unit || existing.unit,
          unitPrice: item.unitPrice || existing.unitPrice,
          lineAmount: item.lineAmount || existing.lineAmount,
          remark: `${existing.remark}；${item.remark}`,
        });
      }
    };

    modelItems.forEach(upsert);
    ruleItems.forEach(upsert);
    return [...merged.values()].slice(0, this.maxParsedQuotationItems);
  }

  private isCoveredByExistingModelItem(
    item: ParsedQuotationItem,
    existingItems: ParsedQuotationItem[],
  ) {
    const itemLeafKey = this.quotationTitleLeafKey(item.itemName);
    if (!itemLeafKey) {
      return false;
    }
    return existingItems
      .filter((existing) => existing.source === 'model')
      .some((existing) => {
        const itemKey = this.quotationItemMergeKey(item);
        const existingKey = this.quotationItemMergeKey(existing);
        const existingLeafKey = this.quotationTitleLeafKey(existing.itemName);
        const sameLeaf =
          existingKey.includes(itemLeafKey) ||
          itemKey.includes(existingLeafKey) ||
          itemLeafKey.includes(existingLeafKey);
        const sameAmount =
          item.lineAmount <= 0 ||
          existing.lineAmount <= 0 ||
          Math.abs(existing.lineAmount - item.lineAmount) < 0.01;
        return sameLeaf && sameAmount;
      });
  }

  private quotationTitleLeafKey(value: string) {
    const leaf = value.split('>').pop() ?? value;
    return this.normalizeQuotationTitleKey(leaf);
  }

  private quotationItemMergeKey(item: ParsedQuotationItem) {
    return this.compactItemName(item.itemName)
      .replace(/\s+/g, '')
      .replace(/[：:，,;；（）()【】\[\]-]/g, '')
      .toLowerCase();
  }

  private normalizeHierarchyPath(value: unknown) {
    const rawParts = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/>|\/|\\|、|，|,/g)
        : [];
    return rawParts
      .map((part) => this.compactItemName(this.stripLinePrefix(String(part))))
      .filter(Boolean)
      .filter((part) => !this.isQuotationNoiseLine(part))
      .slice(0, 8);
  }

  private compactDescription(value: string) {
    return value
      .trim()
      .replace(/^#{1,6}\s*/, '')
      .replace(/\s+/g, ' ')
      .replace(/^子项描述[:：]\s*/g, '')
      .slice(0, 240);
  }

  private composeQuotationItemTitle(
    hierarchyPath: string[],
    rawTitle: string,
    description: string,
  ) {
    const title = this.compactItemName(this.stripLinePrefix(rawTitle));
    const leaf = title || this.compactItemName(this.stripLinePrefix(description));
    if (!leaf) {
      return '';
    }
    if (/>/.test(title)) {
      return title;
    }

    const parts = hierarchyPath.filter(Boolean);
    const titleKey = this.normalizeQuotationTitleKey(leaf);
    if (parts.length === 0) {
      return leaf;
    }
    const lastPartKey = this.normalizeQuotationTitleKey(parts[parts.length - 1]);
    if (lastPartKey !== titleKey) {
      parts.push(leaf);
    }
    return this.compactItemName(parts.join(' > '));
  }

  private normalizeQuotationTitleKey(value: string) {
    return value
      .replace(/\s+/g, '')
      .replace(/[：:，,;；、/\\|（）()【】\[\]\->+]/g, '')
      .toLowerCase();
  }

  private applyQuotationHierarchyTitle(item: ParsedQuotationItem) {
    if (!item.category) {
      return item;
    }
    return {
      ...item,
      itemName: this.composeQuotationItemTitle(
        [item.category],
        item.itemName,
        item.itemName,
      ),
    };
  }

  private isDirectoryOnlyQuotationItem(
    itemName: string,
    description: string,
    rawItem: Record<string, unknown>,
  ) {
    const unitPrice = this.normalizeMoneyNumber(rawItem.unitPrice);
    const lineAmount = this.normalizeMoneyNumber(rawItem.lineAmount);
    if (unitPrice > 0 || lineAmount > 0) {
      return false;
    }

    const cleanTitle = this.cleanQuotationHeadingText(itemName);
    const cleanDescription = this.cleanQuotationHeadingText(description);
    const hasRealDescription =
      cleanDescription.length > 0 &&
      cleanDescription !== cleanTitle &&
      !this.isCategoryLine(cleanDescription);
    return !hasRealDescription && this.isCategoryLine(cleanTitle);
  }

  private isExplicitZeroPriceQuotation(value: string) {
    return /免费|赠送|不收费|0\s*元|¥\s*0|￥\s*0/.test(value);
  }

  private normalizePositiveNumber(value: unknown, fallback: number) {
    const number = this.normalizeMoneyNumber(value);
    return number > 0 ? number : fallback;
  }

  private normalizeMoneyNumber(value: unknown) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
    }
    if (typeof value !== 'string') {
      return 0;
    }
    return Number(this.parseMoney(value).toFixed(2));
  }

  private buildQuotationSummary(items: ParsedQuotationItem[]) {
    const totalAmount = items.reduce((sum, item) => sum + item.lineAmount, 0);
    return {
      itemCount: items.length,
      totalAmount: Number(totalAmount.toFixed(2)),
      pricedItemCount: items.filter((item) => item.lineAmount > 0).length,
      unpricedItemCount: items.filter((item) => item.lineAmount <= 0).length,
    };
  }

  private async logQuotationParse(input: {
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    modelName: string | null;
    status: string;
    executionMs: number;
    errorMessage: string | null;
  }) {
    try {
      const log = this.aiExecutionLogsRepository.create({
        scene_code: 'quotation_parse',
        project_id: null,
        object_type: 'quotation_text',
        object_id: null,
        input_json: input.input,
        output_json: input.output,
        model_name: input.modelName,
        status: input.status,
        execution_ms: input.executionMs,
        error_message: input.errorMessage,
        created_by: null,
      });
      const saved = await this.aiExecutionLogsRepository.save(log);
      return saved.id;
    } catch {
      return null;
    }
  }

  private quotationParseLogOutput(input: {
    mode: string;
    modelName: string;
    ruleItemCount: number;
    modelItemCount: number;
    modelError: string | null;
    summary: ReturnType<QuotationsService['buildQuotationSummary']>;
  }) {
    return {
      mode: input.mode,
      modelName: input.modelName,
      ruleItemCount: input.ruleItemCount,
      modelItemCount: input.modelItemCount,
      finalItemCount: input.summary.itemCount,
      totalAmount: input.summary.totalAmount,
      modelError: input.modelError,
    };
  }

  private openAiChatCompletionsUrl() {
    const baseUrl = process.env.OPENAI_BASE_URL!.trim().replace(/\/$/, '');
    return baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;
  }

  private parseJsonObject(content: string) {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) {
      throw new Error('Model response is not JSON');
    }
    return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as unknown;
  }

  private parseQuotationText(rawContent: string) {
    const ignoredLines: string[] = [];
    const items: ParsedQuotationItem[] = [];
    let currentCategory: string | null = null;

    for (const line of this.normalizeQuotationLines(rawContent)) {
      const cleaned = this.stripLinePrefix(line).replace(/\s+/g, ' ');
      if (!cleaned) {
        continue;
      }
      if (this.isQuotationNoiseLine(cleaned)) {
        ignoredLines.push(cleaned);
        continue;
      }
      if (this.isCategoryLine(cleaned)) {
        currentCategory = this.compactItemName(cleaned.replace(/[：:]$/g, ''));
        continue;
      }

      const parsed = this.parseQuotationLine(cleaned, currentCategory);
      if (parsed.length === 0) {
        ignoredLines.push(cleaned);
        continue;
      }
      items.push(...parsed);
      if (items.length >= this.maxParsedQuotationItems) {
        break;
      }
    }

    const slicedItems = items.slice(0, this.maxParsedQuotationItems);
    return {
      items: slicedItems,
      ignoredLines,
      summary: this.buildQuotationSummary(slicedItems),
    };
  }

  private parseQuotationLine(line: string, category: string | null) {
    const columns = line
      .split(/\t|,|，|\||\s{2,}/g)
      .map((item) => item.trim())
      .filter(Boolean);
    const fallbackColumns =
      columns.length === 1 && /\s/.test(line) ? line.split(/\s+/g) : columns;
    const structured = this.parseStructuredColumns(
      fallbackColumns,
      line,
      category,
    );
    if (structured) {
      return this.splitCompoundItem(structured);
    }

    const moneyMatches = [
      ...line.matchAll(
        /(?:¥|￥)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:元|万元)?/g,
      ),
    ];
    if (moneyMatches.length > 0) {
      const last = moneyMatches[moneyMatches.length - 1];
      const unitPrice = this.parseMoney(last[0]);
      const itemName = this.compactItemName(
        line.slice(0, last.index).replace(/[：:，,;；-]+$/g, ''),
      );
      if (itemName) {
        return this.splitCompoundItem({
          itemName,
          pricingMode: 'fixed',
          quantity: 1,
          unit: this.guessUnit(line),
          unitPrice,
          lineAmount: unitPrice,
          remark: this.withCategoryRemark(line, category),
          category,
        });
      }
    }

    return [];
  }

  private parseStructuredColumns(
    columns: string[],
    original: string,
    category: string | null,
  ) {
    if (columns.length < 2) {
      return null;
    }
    const numericIndexes = columns
      .map((column, index) => ({
        index,
        value: this.parseMoney(column),
        valid: this.isNumberLike(column),
      }))
      .filter((item) => item.valid);
    if (numericIndexes.length === 0) {
      return null;
    }

    const amount = numericIndexes[numericIndexes.length - 1];
    const unitPrice = numericIndexes[numericIndexes.length - 2] ?? amount;
    const quantity =
      numericIndexes.length >= 3
        ? numericIndexes[numericIndexes.length - 3]
        : { index: -1, value: 1 };
    const unitIndex = this.findUnitColumnIndex(columns, unitPrice.index);
    const nameEndIndex =
      quantity.index >= 0
        ? quantity.index
        : unitIndex >= 0
          ? unitIndex
          : Math.min(unitPrice.index, amount.index);
    const itemName = this.compactItemName(
      columns
        .slice(0, Math.max(1, nameEndIndex))
        .join(' ')
        .replace(/^(?:报价项|服务内容|项目|名称)\s*/g, ''),
    );
    if (!itemName || this.isQuotationNoiseLine(itemName)) {
      return null;
    }

    const unitCandidate =
      quantity.index >= 0
        ? columns
            .slice(quantity.index + 1, unitPrice.index)
            .find((column) => this.unitFromColumn(column))
        : unitIndex >= 0
          ? columns[unitIndex]
          : null;
    const lineAmount =
      numericIndexes.length >= 2
        ? amount.value
        : quantity.value * unitPrice.value;

    return {
      itemName,
      pricingMode: 'fixed',
      quantity: quantity.value,
      unit: this.unitFromColumn(unitCandidate) || this.guessUnit(original),
      unitPrice: unitPrice.value,
      lineAmount,
      remark: this.withCategoryRemark(original, category),
      category,
    };
  }

  private findUnitColumnIndex(columns: string[], priceIndex: number) {
    for (let index = priceIndex - 1; index >= 0; index -= 1) {
      const column = columns[index];
      if (this.isNumberLike(column)) {
        continue;
      }
      if (this.unitFromColumn(column)) {
        return index;
      }
      if (priceIndex - index > 2) {
        break;
      }
    }
    return -1;
  }

  private normalizeQuotationLines(rawContent: string) {
    const rows = String(rawContent || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const lines: string[] = [];
    for (const row of rows) {
      if (
        lines.length > 0 &&
        !this.hasMoneyOrNumber(row) &&
        !this.isCategoryLine(row) &&
        /[、，,；;]$/.test(lines[lines.length - 1])
      ) {
        lines[lines.length - 1] = `${lines[lines.length - 1]} ${row}`;
      } else {
        lines.push(row);
      }
    }
    return lines;
  }

  private stripLinePrefix(value: string) {
    return value
      .trim()
      .replace(/^#{1,6}\s*/, '')
      .replace(
        /^[\s|,，;；]*(?:[-*]|\d+(?:[.、),，]|\s+)|[一二三四五六七八九十]+[、.])\s*/,
        '',
      );
  }

  private isCategoryLine(value: string) {
    const text = this.cleanQuotationHeadingText(value);
    return (
      !this.hasMoneyOrNumber(text) &&
      (/[：:]$/.test(text) ||
        /^(一|二|三|四|五|六|七|八|九|十)、/.test(text) ||
        /^(?:[一二三四五六七八九十]+|第[一二三四五六七八九十]+)[、.．]/.test(
          text,
        ) ||
        /^[（(]?[一二三四五六七八九十]+[）)]/.test(text) ||
        (/服务$/.test(text) && text.length <= 24) ||
        (/(?:设计|文案|运营|社区)$/.test(text) && text.length <= 24) ||
        /^(设计服务|内容服务|运营服务|数据服务|投教服务|合规服务|基础服务|增值服务)$/.test(
          text,
        ))
    );
  }

  private splitCompoundItem(item: ParsedQuotationItem) {
    const parts = this.extractCompoundParts(item.itemName);
    if (parts.length <= 1) {
      return [this.applyQuotationHierarchyTitle(item)];
    }
    const splitAmount = Number((item.lineAmount / parts.length).toFixed(2));
    return parts.map((part, index) => ({
      ...this.applyQuotationHierarchyTitle({
        ...item,
        itemName: part,
        quantity: 1,
        unit: item.unit || '项',
        lineAmount:
          index === parts.length - 1
            ? Number(
                (
                  item.lineAmount -
                  splitAmount * (parts.length - 1)
                ).toFixed(2),
              )
            : splitAmount,
        unitPrice:
          index === parts.length - 1
            ? Number(
                (
                  item.lineAmount -
                  splitAmount * (parts.length - 1)
                ).toFixed(2),
              )
            : splitAmount,
        remark: `${item.remark}；由合并报价项拆分为 ${parts.length} 个子项`,
      }),
    }));
  }

  private extractCompoundParts(itemName: string) {
    const normalized = itemName
      .replace(/^(?:包含|包括|服务内容|报价内容)[:：]/, '')
      .trim();
    if (!/[、；;\/]/.test(normalized)) {
      return [];
    }
    const parts = normalized
      .split(/[、；;\/]/g)
      .map((part) => this.compactItemName(part))
      .filter((part) => part.length >= 2)
      .filter((part) => this.hasServiceSignal(part));
    return parts.length >= 2 ? parts : [];
  }

  private isQuotationNoiseLine(value: string) {
    const text = this.cleanQuotationHeadingText(value);
    if (
      /^(报价单|报价明细|服务报价|报价日期|客户|项目名称|项目|合计|总计|小计|备注|说明)[:：]?/.test(
        text,
      )
    ) {
      return true;
    }
    return /序号.*(报价项|服务内容|项目|名称).*金额/.test(text);
  }

  private hasMoneyOrNumber(value: string) {
    return /(?:¥|￥)?\s*\d+(?:,\d{3})*(?:\.\d+)?\s*(?:元|万元)?/.test(value);
  }

  private hasServiceSignal(value: string) {
    return /设计|制作|撰写|输出|报告|文案|长图|海报|数据|核对|投教|官网|材料|页面|运营|排版|校对|更新|维护|审核|披露|专题|Banner|banner|KV|H5|word|Word|WORD/.test(
      value,
    );
  }

  private isNumberLike(value: string) {
    return /^(?:¥|￥)?\s*\d+(?:,\d{3})*(?:\.\d+)?\s*(?:元|万元)?$/.test(
      value.trim(),
    );
  }

  private parseMoney(value: string) {
    const text = value.trim();
    const isTenThousand = /万元/.test(text);
    const number = Number(text.replace(/万元/g, '').replace(/[¥￥元,\s]/g, ''));
    if (!Number.isFinite(number)) {
      return 0;
    }
    return isTenThousand ? number * 10000 : number;
  }

  private guessUnit(value: string) {
    return (
      value.match(/(项|套|份|篇|张|个|条|期|页|次|场|小时|工作日)/)?.[1] ??
      this.unitFromColumn(value) ??
      '项'
    );
  }

  private unitFromColumn(value: string | null | undefined) {
    const text = String(value || '').trim();
    if (!text) {
      return null;
    }
    return (
      text.match(/(?:元|￥|¥)?\s*\/\s*(项|套|份|篇|张|个|条|期|页|次|场|小时|工作日)/)
        ?.[1] ??
      text.match(/^(项|套|份|篇|张|个|条|期|页|次|场|小时|工作日)$/)?.[1] ??
      null
    );
  }

  private compactItemName(value: string) {
    return value
      .trim()
      .replace(/^#{1,6}\s*/, '')
      .replace(/\s+/g, ' ')
      .replace(/^[：:，,;；-]+|[：:，,;；-]+$/g, '')
      .slice(0, 128);
  }

  private cleanQuotationHeadingText(value: string) {
    return String(value || '')
      .trim()
      .replace(/^#{1,6}\s*/, '')
      .replace(/\s+/g, '')
      .replace(/^[一二三四五六七八九十]+[、.．]/, '')
      .replace(/^第[一二三四五六七八九十]+[、.．]/, '')
      .replace(/^[（(][一二三四五六七八九十]+[）)]/, '');
  }

  private withCategoryRemark(original: string, category: string | null) {
    return category ? `【${category}】${original}` : original;
  }
}

type ParsedQuotationItem = {
  itemName: string;
  pricingMode: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineAmount: number;
  remark: string;
  category: string | null;
  source?: string;
};
