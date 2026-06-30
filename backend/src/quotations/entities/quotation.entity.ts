import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('quotations')
export class QuotationEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 32 })
  quotation_no!: string;

  @Column({ type: 'char', length: 36 })
  project_id!: string;

  @Column({ type: 'varchar', length: 32 })
  customer_code!: string;

  @Column({ type: 'varchar', length: 7, nullable: true })
  contract_start_month!: string | null;

  @Column({ type: 'varchar', length: 7, nullable: true })
  contract_end_month!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 32 })
  pricing_basis!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  total_amount!: string;

  @Column({ type: 'int', default: 1 })
  version_no!: number;

  @Column({ type: 'datetime', nullable: true })
  confirmed_at!: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remark!: string | null;
}
