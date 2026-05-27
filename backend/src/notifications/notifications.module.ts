import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { FeishuModule } from '../integrations/feishu/feishu.module';
import { ProjectEntity } from '../projects/entities/project.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { UserEntity } from '../users/entities/user.entity';
import { NotificationMessageEntity } from './entities/notification-message.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    FeishuModule,
    TypeOrmModule.forFeature([
      NotificationMessageEntity,
      UserEntity,
      ProjectEntity,
      TaskEntity,
      WorklogEntity,
      FeishuSyncLogEntity,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
