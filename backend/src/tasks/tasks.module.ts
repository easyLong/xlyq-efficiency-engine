import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { FeishuModule } from '../integrations/feishu/feishu.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { TaskDirectoryEntity } from './entities/task-directory.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskResultFileEntity } from './entities/task-result-file.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    FeishuModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      TaskEntity,
      ProjectEntity,
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
