import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('customers')
export class CustomerEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'varchar', length: 32, nullable: true })
  customer_code!: string | null;

  @Column({ type: 'varchar', length: 128 })
  customer_name!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  contact_name!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  contact_mobile!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  contact_email!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  industry!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  source!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;
}
