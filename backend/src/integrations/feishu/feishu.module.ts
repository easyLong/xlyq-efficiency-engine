import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from '../../tasks/entities/task.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { FeishuSyncLogEntity } from './entities/feishu-sync-log.entity';
import { FeishuController } from './feishu.controller';
import { FeishuOpenApiClient } from './feishu-openapi.client';
import { FeishuService } from './feishu.service';
import { FeishuSheetClient } from './feishu-sheet.client';
import { FeishuTaskCardActionHandler } from './feishu-task-card-action.handler';
import { FeishuUserSyncService } from './feishu-user-sync.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([FeishuSyncLogEntity, UserEntity, TaskEntity]),
  ],
  controllers: [FeishuController],
  providers: [
    FeishuOpenApiClient,
    FeishuSheetClient,
    FeishuTaskCardActionHandler,
    FeishuUserSyncService,
    FeishuService,
  ],
  exports: [FeishuService],
})
export class FeishuModule {}
