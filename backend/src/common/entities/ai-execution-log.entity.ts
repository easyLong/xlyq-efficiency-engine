import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { BeforeInsert } from 'typeorm';

@Entity('ai_execution_logs')
export class AiExecutionLogEntity {
  @PrimaryColumn('char', { length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  scene_code!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  project_id!: string | null;

  @Column({ type: 'varchar', length: 32 })
  object_type!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  object_id!: string | null;

  @Column({ type: 'json', nullable: true })
  input_json!: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  output_json!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model_name!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'int', nullable: true })
  execution_ms!: number | null;

  @Column({ type: 'text', nullable: true })
  error_message!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  created_by!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @BeforeInsert()
  assignId() {
    this.id ??= randomUUID();
  }
}
