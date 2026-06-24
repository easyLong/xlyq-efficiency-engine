import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('users')
export class UserEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 64 })
  username!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  passwd!: string | null;

  @Column({ type: 'boolean', default: false })
  login_enabled!: boolean;

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

  @Column({ type: 'varchar', length: 255, nullable: true })
  password_hash!: string | null;

  @Column({ type: 'datetime', nullable: true })
  password_updated_at!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  last_login_at!: Date | null;
}
