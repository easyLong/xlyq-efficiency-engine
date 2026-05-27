import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { RiskAlertEntity } from '../common/entities/risk-alert.entity';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { WeeklyReportEntity } from './entities/weekly-report.entity';
import { WeeklyReportsController } from './weekly-reports.controller';
import { WeeklyReportsService } from './weekly-reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WeeklyReportEntity,
      ProjectEntity,
      TaskEntity,
      WorklogEntity,
      RiskAlertEntity,
      AiExecutionLogEntity,
    ]),
  ],
  controllers: [WeeklyReportsController],
  providers: [WeeklyReportsService],
})
export class WeeklyReportsModule {}
