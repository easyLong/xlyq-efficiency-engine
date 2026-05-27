import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { randomUUID } from 'node:crypto';

@Entity('requirement_quotation_mappings')
export class RequirementQuotationMappingEntity {
  @PrimaryColumn('char', { length: 36 })
  id!: string;

  @Column({ type: 'char', length: 36 })
  project_id!: string;

  @Column({ type: 'char', length: 36 })
  requirement_item_id!: string;

  @Column({ type: 'char', length: 36, nullable: true })
  quotation_id!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  quotation_item_id!: string | null;

  @Column({ type: 'varchar', length: 32 })
  mapping_status!: string;

  @Column({ type: 'varchar', length: 32 })
  mapping_type!: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  matched_ratio!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
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
