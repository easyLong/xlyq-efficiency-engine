import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('projects')
export class ProjectEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 32 })
  project_code!: string;

  @Column({ type: 'varchar', length: 128 })
  project_name!: string;

  @Column({ type: 'char', length: 36 })
  customer_id!: string;

  @Column({ type: 'char', length: 36 })
  owner_user_id!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  project_type!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  priority!: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  budget_amount!: string | null;

  @Column({ type: 'date', nullable: true })
  planned_end_date!: string | null;

  @Column({ type: 'date', nullable: true })
  actual_end_date!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}
