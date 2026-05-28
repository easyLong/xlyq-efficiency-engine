import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { CreateQuotationItemDto } from './dto/create-quotation-item.dto';
import { ImportQuotationTextDto } from './dto/import-quotation-text.dto';
import { ParseQuotationTextDto } from './dto/parse-quotation-text.dto';
import { ReviewQuotationDto } from './dto/review-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { UpdateQuotationItemDto } from './dto/update-quotation-item.dto';
import { QuotationItemEntity } from './entities/quotation-item.entity';
import { QuotationEntity } from './entities/quotation.entity';

@Injectable()
export class QuotationsService {
  private readonly defaultListLimit = 500;

  constructor(
    @InjectRepository(QuotationEntity)
    private readonly quotationsRepository: Repository<QuotationEntity>,
    @InjectRepository(QuotationItemEntity)
    private readonly quotationItemsRepository: Repository<QuotationItemEntity>,
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
    const parsed = this.parseQuotationText(dto.rawContent);
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
      source: dto.fileName ?? 'manual_paste',
    };
  }

  parseText(dto: ParseQuotationTextDto) {
    const parsed = this.parseQuotationText(dto.rawContent);
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
    await this.quotationItemsRepository.softDelete(itemId);
    await this.recalculateTotal(item.quotation_id);
    return { success: true };
  }

  async remove(id: string) {
    await this.findOne(id);
    const items = await this.quotationItemsRepository.find({
      where: { quotation_id: id },
    });
    const itemIds = items.map((item) => item.id);
    if (itemIds.length > 0) {
      await this.quotationItemsRepository.softDelete({ id: In(itemIds) });
    }
    await this.quotationsRepository.softDelete(id);
    return {
      quotationId: id,
      deletedItemCount: itemIds.length,
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
      if (items.length >= 200) {
        break;
      }
    }

    const slicedItems = items.slice(0, 200);
    const totalAmount = slicedItems.reduce(
      (sum, item) => sum + item.lineAmount,
      0,
    );
    return {
      items: slicedItems,
      ignoredLines,
      summary: {
        itemCount: slicedItems.length,
        totalAmount: Number(totalAmount.toFixed(2)),
        pricedItemCount: slicedItems.filter((item) => item.lineAmount > 0)
          .length,
        unpricedItemCount: slicedItems.filter((item) => item.lineAmount <= 0)
          .length,
      },
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

    if (this.hasServiceSignal(line)) {
      return this.splitCompoundItem({
        itemName: this.compactItemName(line),
        pricingMode: 'fixed',
        quantity: 1,
        unit: this.guessUnit(line),
        unitPrice: 0,
        lineAmount: 0,
        remark: this.withCategoryRemark(line, category),
        category,
      });
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
    const nameEndIndex =
      quantity.index >= 0
        ? quantity.index
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
            .find((column) => !this.isNumberLike(column))
        : null;
    const lineAmount =
      numericIndexes.length >= 2
        ? amount.value
        : quantity.value * unitPrice.value;

    return {
      itemName,
      pricingMode: 'fixed',
      quantity: quantity.value,
      unit: unitCandidate || this.guessUnit(original),
      unitPrice: unitPrice.value,
      lineAmount,
      remark: this.withCategoryRemark(original, category),
      category,
    };
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
      .replace(
        /^[\s|,，;；]*(?:[-*]|\d+(?:[.、),，]|\s+)|[一二三四五六七八九十]+[、.])\s*/,
        '',
      );
  }

  private isCategoryLine(value: string) {
    const text = value.replace(/\s+/g, '');
    return (
      !this.hasMoneyOrNumber(text) &&
      (/[：:]$/.test(text) ||
        /^(一|二|三|四|五|六|七|八|九|十)、/.test(text) ||
        /^(设计服务|内容服务|运营服务|数据服务|投教服务|合规服务|基础服务|增值服务)$/.test(
          text,
        ))
    );
  }

  private splitCompoundItem(item: ParsedQuotationItem) {
    const parts = this.extractCompoundParts(item.itemName);
    if (parts.length <= 1) {
      return [item];
    }
    const splitAmount = Number((item.lineAmount / parts.length).toFixed(2));
    return parts.map((part, index) => ({
      ...item,
      itemName: part,
      quantity: 1,
      unit: item.unit || '项',
      lineAmount:
        index === parts.length - 1
          ? Number(
              (item.lineAmount - splitAmount * (parts.length - 1)).toFixed(2),
            )
          : splitAmount,
      unitPrice:
        index === parts.length - 1
          ? Number(
              (item.lineAmount - splitAmount * (parts.length - 1)).toFixed(2),
            )
          : splitAmount,
      remark: `${item.remark}；由合并报价项拆分为 ${parts.length} 个子项`,
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
    const text = value.replace(/\s+/g, '');
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
      value.match(/(项|套|份|篇|张|个|条|期|页|次|小时|工作日)/)?.[1] ?? '项'
    );
  }

  private compactItemName(value: string) {
    return value
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^[：:，,;；-]+|[：:，,;；-]+$/g, '')
      .slice(0, 128);
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
};
