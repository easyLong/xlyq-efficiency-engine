import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { ensureIndex } from '../common/schema-maintenance';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { CreateContactContextConfigDto } from './dto/create-contact-context-config.dto';
import { UpdateContactContextConfigDto } from './dto/update-contact-context-config.dto';
import { ContactContextConfigEntity } from './entities/contact-context-config.entity';

@Injectable()
export class ContactContextsService implements OnModuleInit {
  constructor(
    @InjectRepository(ContactContextConfigEntity)
    private readonly configsRepository: Repository<ContactContextConfigEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customersRepository: Repository<CustomerEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureContactContextSchema();
  }

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

  private async ensureContactContextSchema() {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = 'contact_context_configs'
      `,
    );
    if (Number(rows?.[0]?.count || 0) === 0) return;
    await this.dropColumnIfExists(
      'contact_context_configs',
      'business_category',
    );
    await this.dropColumnIfExists(
      'contact_context_configs',
      'secondary_category',
    );
    await this.dropColumnIfExists(
      'contact_context_configs',
      'tertiary_category',
    );
    await ensureIndex(
      this.dataSource,
      'contact_context_configs',
      'idx_contact_context_customer_status',
      ['customer_id', 'status'],
    );
    await ensureIndex(
      this.dataSource,
      'contact_context_configs',
      'idx_contact_context_name',
      ['contact_name'],
    );
    await ensureIndex(
      this.dataSource,
      'contact_context_configs',
      'idx_contact_context_platform',
      ['business_platform'],
    );
  }

  private async dropColumnIfExists(tableName: string, columnName: string) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [tableName, columnName],
    );
    if (Number(rows?.[0]?.count || 0) === 0) return;
    await this.dataSource.query(
      `ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``,
    );
  }
}
