import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('quotation_items')
export class QuotationItemEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'char', length: 36 })
  quotation_id!: string;

  @Column({ type: 'varchar', length: 64 })
  item_code!: string;

  @Column({ type: 'varchar', length: 128 })
  item_name!: string;

  @Column({ type: 'varchar', length: 32 })
  pricing_mode!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 1 })
  quantity!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  unit!: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  unit_price!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  line_amount!: string;

  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @Column({ type: 'varchar', length: 32 })
  match_status!: string;

  @Column({ type: 'int', nullable: true })
  sort_order!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remark!: string | null;
}
