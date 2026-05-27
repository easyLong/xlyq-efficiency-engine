import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('requirement_items')
export class RequirementItemEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'char', length: 36 })
  requirement_id!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  parent_item_id!: string | null;

  @Column({ type: 'varchar', length: 64 })
  item_no!: string;

  @Column({ type: 'varchar', length: 256 })
  item_title!: string;

  @Column({ type: 'text', nullable: true })
  item_description!: string | null;

  @Column({ type: 'text', nullable: true })
  business_goal!: string | null;

  @Column({ type: 'text', nullable: true })
  acceptance_criteria!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  priority!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 32 })
  quote_scope_status!: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  estimated_hours!: string | null;
}
