import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export abstract class BaseSoftDeleteEntity {
  @PrimaryColumn('char', { length: 36 })
  id!: string;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;

  @DeleteDateColumn({ type: 'datetime', nullable: true })
  deleted_at!: Date | null;

  @BeforeInsert()
  assignId() {
    this.id ??= randomUUID();
  }
}
