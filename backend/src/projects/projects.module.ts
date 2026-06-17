import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequirementEntity } from '../requirements/entities/requirement.entity';
import { RiskAlertEntity } from '../common/entities/risk-alert.entity';
import { QuotationEntity } from '../quotations/entities/quotation.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { ProjectEntity } from './entities/project.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity,
      RequirementEntity,
      TaskEntity,
      QuotationEntity,
      RiskAlertEntity,
      CustomerEntity,
    ]),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
