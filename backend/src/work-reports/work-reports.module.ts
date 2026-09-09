import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowConfigsModule } from '../workflow-configs/workflow-configs.module';
import { WorkReportsController } from './work-reports.controller';
import { WorkReportsService } from './work-reports.service';

@Module({
  imports: [NotificationsModule, WorkflowConfigsModule],
  controllers: [WorkReportsController],
  providers: [WorkReportsService],
})
export class WorkReportsModule {}
