import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { CreateQuotationItemDto } from './dto/create-quotation-item.dto';
import { ReviewQuotationDto } from './dto/review-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { UpdateQuotationItemDto } from './dto/update-quotation-item.dto';
import { QuotationItemEntity } from './entities/quotation-item.entity';
import { QuotationEntity } from './entities/quotation.entity';

@Injectable()
export class QuotationsService {
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
      take: 100,
    });
  }

  async findOne(id: string) {
    const quotation = await this.quotationsRepository.findOne({ where: { id } });
    if (!quotation) {
      throw new NotFoundException('Quotation not found');
    }
    return quotation;
  }

  async create(dto: CreateQuotationDto) {
    const quotation = this.quotationsRepository.create({
      id: randomUUID(),
      quotation_no:
        dto.quotationNo ??
        `QT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)
          .toString()
          .padStart(3, '0')}`,
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
    const count = await this.quotationItemsRepository.count({
      where: { quotation_id: quotationId },
    });
    const quantity = Number(dto.quantity ?? '1');
    const unitPrice = Number(dto.unitPrice ?? '0');
    const item = this.quotationItemsRepository.create({
      id: randomUUID(),
      quotation_id: quotationId,
      item_code: dto.itemCode ?? `ITEM-${String(count + 1).padStart(3, '0')}`,
      item_name: dto.itemName,
      pricing_mode: dto.pricingMode ?? 'fixed',
      quantity: quantity.toFixed(2),
      unit: dto.unit ?? null,
      unit_price: unitPrice.toFixed(2),
      line_amount: (quantity * unitPrice).toFixed(2),
      source: dto.source ?? 'manual',
      match_status: dto.matchStatus ?? 'manual_added',
      remark: dto.remark ?? null,
      sort_order: count + 1,
    });
    const saved = await this.quotationItemsRepository.save(item);
    await this.recalculateTotal(quotationId);
    return saved;
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
}
