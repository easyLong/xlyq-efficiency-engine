import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from '../projects/entities/project.entity';
import { QuotationEntity } from '../quotations/entities/quotation.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { RequirementsModule } from '../requirements/requirements.module';
import { TaskResultFileEntity } from '../tasks/entities/task-result-file.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    RequirementsModule,
    TasksModule,
    TypeOrmModule.forFeature([
      ProjectEntity,
      TaskEntity,
      QuotationEntity,
      RequirementQuotationMappingEntity,
      TaskResultFileEntity,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
