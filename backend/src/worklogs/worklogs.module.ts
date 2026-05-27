import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { WorklogsController } from './worklogs.controller';
import { WorklogsService } from './worklogs.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorklogEntity, TaskEntity])],
  controllers: [WorklogsController],
  providers: [WorklogsService],
  exports: [WorklogsService],
})
export class WorklogsModule {}
