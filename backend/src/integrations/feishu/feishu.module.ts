import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from '../../tasks/entities/task.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { FeishuSyncLogEntity } from './entities/feishu-sync-log.entity';
import { FeishuController } from './feishu.controller';
import { FeishuService } from './feishu.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([FeishuSyncLogEntity, UserEntity, TaskEntity]),
  ],
  controllers: [FeishuController],
  providers: [FeishuService],
  exports: [FeishuService],
})
export class FeishuModule {}
