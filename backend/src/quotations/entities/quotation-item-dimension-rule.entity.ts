import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('quotation_item_dimension_rules')
export class QuotationItemDimensionRuleEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'char', length: 36 })
  quotation_item_id!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  customer_id!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  business_platform!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  business_category!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  secondary_category!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tertiary_category!: string | null;

  @Column({ type: 'int', default: 100 })
  priority!: number;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;
}
