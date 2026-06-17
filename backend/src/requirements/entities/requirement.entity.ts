import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('requirements')
export class RequirementEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 32 })
  requirement_code!: string;

  @Column({ type: 'char', length: 36 })
  project_id!: string;

  @Column({ type: 'varchar', length: 32 })
  customer_code!: string;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'varchar', length: 32 })
  source_type!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  source_ref_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  business_name!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  business_platform!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  business_category!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  secondary_category!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tertiary_category!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  priority!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  urgency_level!: string | null;

  @Column({ type: 'text', nullable: true })
  raw_content!: string | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'datetime', nullable: true })
  confirmed_at!: Date | null;
}
