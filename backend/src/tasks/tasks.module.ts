import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { TaskDirectoryEntity } from './entities/task-directory.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskResultFileEntity } from './entities/task-result-file.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    NotificationsModule,
    TypeOrmModule.forFeature([
      TaskEntity,
      RequirementItemEntity,
      TaskDirectoryEntity,
      TaskResultFileEntity,
      FeishuSyncLogEntity,
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
