import { Column, Entity, Index } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('dimension_dictionaries')
@Index('uk_dimension_type_code', ['dimension_type', 'dimension_code'], {
  unique: true,
})
@Index('idx_dimension_type_parent', ['dimension_type', 'parent_code'])
export class DimensionDictionaryEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 32 })
  dimension_type!: string;

  @Column({ type: 'varchar', length: 64 })
  dimension_code!: string;

  @Column({ type: 'varchar', length: 128 })
  dimension_name!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  product_type!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  parent_code!: string | null;

  @Column({ type: 'int', default: 100 })
  sort_order!: number;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  estimated_hours!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  contribution_points!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  measure_unit!: string | null;

  @Column({ type: 'text', nullable: true })
  content_scope!: string | null;

  @Column({ type: 'text', nullable: true })
  delivery_standard!: string | null;

  @Column({ type: 'text', nullable: true })
  scoring_boundary!: string | null;

  @Column({ type: 'int', nullable: true })
  reference_minutes!: number | null;
}
