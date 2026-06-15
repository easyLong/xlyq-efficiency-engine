import { Column, Entity, Index } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('business_category_secondary_categories')
@Index(
  'uk_business_category_secondary',
  ['business_category_code', 'secondary_category_code'],
  { unique: true },
)
@Index('idx_business_category_secondary_status', ['status'])
export class BusinessCategorySecondaryCategoryEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 64 })
  business_category_code!: string;

  @Column({ type: 'varchar', length: 64 })
  business_category_name!: string;

  @Column({ type: 'varchar', length: 64 })
  secondary_category_code!: string;

  @Column({ type: 'varchar', length: 64 })
  secondary_category_name!: string;

  @Column({ type: 'int', default: 100 })
  category_sort_order!: number;

  @Column({ type: 'int', default: 100 })
  secondary_sort_order!: number;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;
}
