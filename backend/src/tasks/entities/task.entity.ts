import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('tasks')
export class TaskEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'char', length: 36 })
  project_id!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  requirement_item_id!: string | null;

  @Column({ type: 'varchar', length: 32 })
  task_no!: string;

  @Column({ type: 'varchar', length: 256 })
  task_name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 32, default: 'none' })
  review_stage!: string;

  @Column({ type: 'varchar', length: 32, default: 'dispatch' })
  current_step!: string;

  @Column({ type: 'int', default: 0 })
  delivery_version!: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  returned_from_step!: string | null;

  @Column({ type: 'int', default: 0 })
  workflow_version!: number;

  @Column({ type: 'datetime', nullable: true })
  last_transition_at!: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  priority!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  urgency_level!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  assignee_user_id!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  reporter_user_id!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  dispatcher_user_id!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  product_review_type!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  product_reviewer_user_id!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  customer_reviewer_user_id!: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  estimated_hours!: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  actual_hours!: string;

  @Column({ type: 'int', default: 0 })
  progress_percent!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  blocked_reason!: string | null;

  @Column({ type: 'datetime', nullable: true })
  planned_start_at!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  planned_end_at!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  actual_end_at!: Date | null;
}
