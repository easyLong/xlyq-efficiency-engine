import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerEntity } from './entities/customer.entity';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(CustomerEntity)
    private readonly customersRepository: Repository<CustomerEntity>,
  ) {}

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
}
