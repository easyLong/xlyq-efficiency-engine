import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeishuSyncLogEntity } from '../integrations/feishu/entities/feishu-sync-log.entity';
import { FeishuModule } from '../integrations/feishu/feishu.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { RequirementEntity } from '../requirements/entities/requirement.entity';
import { UserEntity } from '../users/entities/user.entity';
import { WorkflowConfigsModule } from '../workflow-configs/workflow-configs.module';
import { TaskDirectoryEntity } from './entities/task-directory.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskResultFileEntity } from './entities/task-result-file.entity';
import { TaskStatusHistoryEntity } from './entities/task-status-history.entity';
import { TasksController } from './tasks.controller';
import { TaskWorkflowRuntimeService } from './task-workflow-runtime.service';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    FeishuModule,
    NotificationsModule,
    WorkflowConfigsModule,
    TypeOrmModule.forFeature([
      TaskEntity,
      ProjectEntity,
      RequirementEntity,
      RequirementItemEntity,
      UserEntity,
      TaskDirectoryEntity,
      TaskResultFileEntity,
      TaskStatusHistoryEntity,
      FeishuSyncLogEntity,
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskWorkflowRuntimeService],
  exports: [TasksService, TaskWorkflowRuntimeService],
})
export class TasksModule {}
