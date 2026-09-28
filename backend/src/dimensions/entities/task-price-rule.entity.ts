import { Column, Entity, Index } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('task_price_rules')
@Index('idx_task_price_rule_customer_status', ['customer_code', 'status'])
@Index('idx_task_price_rule_category', [
  'business_category_code',
  'secondary_category_code',
  'tertiary_category_code',
])
export class TaskPriceRuleEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 32 })
  customer_code!: string;

  @Column({ type: 'varchar', length: 64 })
  business_category_code!: string;

  @Column({ type: 'varchar', length: 64 })
  secondary_category_code!: string;

  @Column({ type: 'varchar', length: 64 })
  tertiary_category_code!: string;

  @Column({ type: 'varchar', length: 32 })
  pricing_mode!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  unit_price!: string;

  @Column({ type: 'date', nullable: true })
  effective_from!: string | null;

  @Column({ type: 'date', nullable: true })
  effective_to!: string | null;

  @Column({ type: 'int', default: 1 })
  version_no!: number;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;
}
