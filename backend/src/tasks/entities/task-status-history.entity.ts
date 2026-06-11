import { Column, Entity, Index } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('task_status_histories')
@Index('idx_task_status_histories_task_created', ['task_id', 'created_at'])
export class TaskStatusHistoryEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'char', length: 36 })
  task_id!: string;

  @Column({ type: 'varchar', length: 32 })
  from_status!: string;

  @Column({ type: 'varchar', length: 32 })
  to_status!: string;

  @Column({ type: 'varchar', length: 64 })
  trigger_source!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;
}
