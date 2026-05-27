import { Column, Entity } from 'typeorm';
import { BaseSoftDeleteEntity } from '../../common/entities/base-soft-delete.entity';

@Entity('notification_messages')
export class NotificationMessageEntity extends BaseSoftDeleteEntity {
  @Column({ type: 'char', length: 36, nullable: true })
  recipient_user_id!: string | null;

  @Column({ type: 'varchar', length: 128 })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  object_type!: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  object_id!: string | null;

  @Column({ type: 'json', nullable: true })
  channels_json!: string[] | null;

  @Column({ type: 'json', nullable: true })
  delivery_result_json!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'datetime', nullable: true })
  sent_at!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  read_at!: Date | null;

  @Column({ type: 'text', nullable: true })
  error_message!: string | null;
}
