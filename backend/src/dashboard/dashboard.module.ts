import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from '../projects/entities/project.entity';
import { QuotationEntity } from '../quotations/entities/quotation.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity,
      TaskEntity,
      QuotationEntity,
      RequirementQuotationMappingEntity,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
