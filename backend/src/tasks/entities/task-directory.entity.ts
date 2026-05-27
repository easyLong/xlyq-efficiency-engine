import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('task_directories')
export class TaskDirectoryEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'char', length: 36 })
  task_id!: string;

  @Column({ type: 'char', length: 36 })
  project_id!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  assignee_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  feishu_folder_token!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  directory_url!: string | null;

  @Column({ type: 'varchar', length: 32 })
  permission_status!: string;

  @Column({ type: 'datetime', nullable: true })
  last_synced_at!: Date | null;
}
