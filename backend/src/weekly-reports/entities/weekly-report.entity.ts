import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { randomUUID } from 'node:crypto';

@Entity('weekly_reports')
export class WeeklyReportEntity {
  @PrimaryColumn('char', { length: 36 })
  id!: string;

  @Column({ type: 'char', length: 36 })
  project_id!: string;

  @Column({ type: 'varchar', length: 16 })
  report_week!: string;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  generated_by_ai_log_id!: string | null;

  @Column({ type: 'datetime', nullable: true })
  sent_to_feishu_at!: Date | null;

  @Column({ type: 'char', length: 36, nullable: true })
  created_by!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;

  @BeforeInsert()
  assignId() {
    this.id ??= randomUUID();
  }
}
