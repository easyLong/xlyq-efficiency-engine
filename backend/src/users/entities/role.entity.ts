import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { randomUUID } from 'node:crypto';

@Entity('roles')
export class RoleEntity {
  @PrimaryColumn('char', { length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  role_code!: string;

  @Column({ type: 'varchar', length: 64 })
  role_name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;

  @BeforeInsert()
  assignId() {
    this.id ??= randomUUID();
  }
}
