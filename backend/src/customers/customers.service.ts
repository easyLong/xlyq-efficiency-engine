import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerEntity } from './entities/customer.entity';

@Injectable()
export class CustomersService implements OnModuleInit {
  constructor(
    @InjectRepository(CustomerEntity)
    private readonly customersRepository: Repository<CustomerEntity>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultCustomers();
  }

  async findAll(status?: string, keyword?: string) {
    const qb = this.customersRepository.createQueryBuilder('c');
    if (status) {
      qb.andWhere('c.status = :status', { status });
    }
    if (keyword) {
      qb.andWhere(
        '(c.customer_name LIKE :keyword OR c.customer_code LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }
    return qb.orderBy('c.created_at', 'DESC').limit(100).getMany();
  }

  async findOne(id: string) {
    const customer = await this.customersRepository.findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async create(dto: CreateCustomerDto) {
    const customer = this.customersRepository.create({
      id: randomUUID(),
      customer_code: dto.customerCode ?? null,
      customer_name: dto.customerName,
      contact_name: dto.contactName ?? null,
      contact_mobile: dto.contactMobile ?? null,
      contact_email: dto.contactEmail ?? null,
      industry: dto.industry ?? null,
      source: dto.source ?? 'manual',
      status: 'active',
      remark: dto.remark ?? null,
    });
    return this.customersRepository.save(customer);
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const customer = await this.findOne(id);
    Object.assign(customer, {
      customer_code: dto.customerCode ?? customer.customer_code,
      customer_name: dto.customerName ?? customer.customer_name,
      contact_name: dto.contactName ?? customer.contact_name,
      contact_mobile: dto.contactMobile ?? customer.contact_mobile,
      contact_email: dto.contactEmail ?? customer.contact_email,
      industry: dto.industry ?? customer.industry,
      source: dto.source ?? customer.source,
      status: dto.status ?? customer.status,
      remark: dto.remark ?? customer.remark,
    });
    return this.customersRepository.save(customer);
  }

  private async seedDefaultCustomers() {
    const defaults = [
      {
        customerCode: 'VectorEngine',
        customerName: '向量引擎',
        contactName: '雷声',
        industry: '内部项目',
        source: 'system',
        remark: '内部项目客户，用于需求录入',
      },
    ];
    for (const item of defaults) {
      const existing = await this.customersRepository.findOne({
        where: { customer_code: item.customerCode },
      });
      if (existing) {
        if (!existing.contact_name) {
          existing.contact_name = item.contactName;
          await this.customersRepository.save(existing);
        }
        continue;
      }
      await this.customersRepository.save(
        this.customersRepository.create({
          id: randomUUID(),
          customer_code: item.customerCode,
          customer_name: item.customerName,
          contact_name: item.contactName,
          contact_mobile: null,
          contact_email: null,
          industry: item.industry,
          source: item.source,
          status: 'active',
          remark: item.remark,
        }),
      );
    }
  }
}
