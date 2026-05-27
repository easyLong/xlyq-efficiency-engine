import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from './base-soft-delete.entity';

@Entity('worklogs')
export class WorklogEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'char', length: 36 })
  project_id!: string;

  @Column({ type: 'char', length: 36 })
  task_id!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  requirement_item_id!: string | null;

  @Column({ type: 'char', length: 36 })
  user_id!: string;

  @Column({ type: 'date' })
  work_date!: string;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  hours!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  work_summary!: string | null;

  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @Column({ type: 'varchar', length: 32 })
  approval_status!: string;
}
