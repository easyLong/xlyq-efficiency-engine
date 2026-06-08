import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { CreateContactContextConfigDto } from './dto/create-contact-context-config.dto';
import { UpdateContactContextConfigDto } from './dto/update-contact-context-config.dto';
import { ContactContextConfigEntity } from './entities/contact-context-config.entity';

@Injectable()
export class ContactContextsService {
  constructor(
    @InjectRepository(ContactContextConfigEntity)
    private readonly configsRepository: Repository<ContactContextConfigEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customersRepository: Repository<CustomerEntity>,
  ) {}

  async findAll(status?: string, customerId?: string, keyword?: string) {
    const qb = this.configsRepository.createQueryBuilder('config');
    if (status) {
      qb.andWhere('config.status = :status', { status });
    }
    if (customerId) {
      qb.andWhere('config.customer_id = :customerId', { customerId });
    }
    if (keyword) {
      qb.andWhere(
        [
          'config.contact_name LIKE :keyword',
          'config.contact_mobile LIKE :keyword',
          'config.contact_email LIKE :keyword',
          'config.business_platform LIKE :keyword',
          'config.secondary_category LIKE :keyword',
          'config.tertiary_category LIKE :keyword',
        ].join(' OR '),
        { keyword: `%${keyword}%` },
      );
    }
    return qb.orderBy('config.created_at', 'DESC').take(500).getMany();
  }

  async findOne(id: string) {
    const config = await this.configsRepository.findOne({ where: { id } });
    if (!config) {
      throw new NotFoundException('Contact context config not found');
    }
    return config;
  }

  async create(dto: CreateContactContextConfigDto) {
    await this.ensureCustomer(dto.customerId);
    const config = this.configsRepository.create({
      id: randomUUID(),
      contact_name: dto.contactName,
      contact_mobile: dto.contactMobile ?? null,
      contact_email: dto.contactEmail ?? null,
      customer_id: dto.customerId,
      business_platform: dto.businessPlatform ?? null,
      business_category: dto.businessCategory,
      secondary_category: dto.secondaryCategory ?? null,
      tertiary_category:
        dto.tertiaryCategory ?? null,
      status: 'active',
      remark: dto.remark ?? null,
    });
    return this.configsRepository.save(config);
  }

  async update(id: string, dto: UpdateContactContextConfigDto) {
    const config = await this.findOne(id);
    if (dto.customerId) {
      await this.ensureCustomer(dto.customerId);
    }
    Object.assign(config, {
      contact_name: dto.contactName ?? config.contact_name,
      contact_mobile: dto.contactMobile ?? config.contact_mobile,
      contact_email: dto.contactEmail ?? config.contact_email,
      customer_id: dto.customerId ?? config.customer_id,
      business_platform: dto.businessPlatform ?? config.business_platform,
      business_category: dto.businessCategory ?? config.business_category,
      secondary_category: dto.secondaryCategory ?? config.secondary_category,
      tertiary_category:
        dto.tertiaryCategory ??
        config.tertiary_category,
      status: dto.status ?? config.status,
      remark: dto.remark ?? config.remark,
    });
    return this.configsRepository.save(config);
  }

  private async ensureCustomer(customerId: string) {
    const customer = await this.customersRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
  }
}
