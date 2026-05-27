import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  Entity,
  PrimaryColumn,
} from 'typeorm';

@Entity('feishu_sync_logs')
export class FeishuSyncLogEntity {
  @PrimaryColumn('char', { length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  object_type!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  object_id!: string | null;

  @Column({ type: 'varchar', length: 32 })
  action_type!: string;

  @Column({ type: 'varchar', length: 32 })
  feishu_object_type!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  feishu_object_id!: string | null;

  @Column({ type: 'json', nullable: true })
  request_payload_json!: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  response_payload_json!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  error_code!: string | null;

  @Column({ type: 'text', nullable: true })
  error_message!: string | null;

  @Column({ type: 'datetime' })
  triggered_at!: Date;

  @Column({ type: 'datetime', nullable: true })
  finished_at!: Date | null;

  @BeforeInsert()
  assignId() {
    this.id ??= randomUUID();
  }
}
