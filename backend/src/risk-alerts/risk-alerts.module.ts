import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskAlertEntity } from '../common/entities/risk-alert.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { RiskAlertsController } from './risk-alerts.controller';
import { RiskAlertsService } from './risk-alerts.service';

@Module({
  imports: [TypeOrmModule.forFeature([RiskAlertEntity, TaskEntity])],
  controllers: [RiskAlertsController],
  providers: [RiskAlertsService],
})
export class RiskAlertsModule {}
