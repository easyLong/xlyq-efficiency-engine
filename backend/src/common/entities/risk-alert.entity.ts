import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { BeforeInsert } from 'typeorm';

@Entity('risk_alerts')
export class RiskAlertEntity {
  @PrimaryColumn('char', { length: 36 })
  id!: string;

  @Column({ type: 'char', length: 36 })
  project_id!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  task_id!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  requirement_item_id!: string | null;

  @Column({ type: 'varchar', length: 32 })
  alert_type!: string;

  @Column({ type: 'varchar', length: 32 })
  severity!: string;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'datetime' })
  triggered_at!: Date;

  @Column({ type: 'datetime', nullable: true })
  resolved_at!: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;

  @BeforeInsert()
  assignId() {
    this.id ??= randomUUID();
  }
}
