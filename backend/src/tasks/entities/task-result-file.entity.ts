import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('task_result_files')
export class TaskResultFileEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'char', length: 36 })
  task_id!: string;

  @Column({ type: 'char', length: 36 })
  project_id!: string;

  @Column({ type: 'varchar', length: 256 })
  file_name!: string;

  @Column({ type: 'varchar', length: 500 })
  file_url!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  feishu_file_token!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  uploaded_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remark!: string | null;
}
