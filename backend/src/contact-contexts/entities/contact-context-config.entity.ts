import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('contact_context_configs')
export class ContactContextConfigEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 64 })
  contact_name!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  contact_mobile!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  contact_email!: string | null;

  @Column({ type: 'char', length: 36 })
  customer_id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  business_platform!: string | null;

  @Column({ type: 'varchar', length: 32 })
  business_category!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  secondary_category!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tertiary_category!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;
}
