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

  @Column({ type: 'varchar', length: 64, nullable: true })
  parent_code!: string | null;

  @Column({ type: 'int', default: 100 })
  sort_order!: number;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;
}
