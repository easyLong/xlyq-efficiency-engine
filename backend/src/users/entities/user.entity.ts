import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('users')
export class UserEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 64 })
  username!: string;

  @Column({ type: 'varchar', length: 64 })
  display_name!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  mobile!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatar_url!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  feishu_open_id!: string | null;
}
