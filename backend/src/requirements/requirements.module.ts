import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { ContactContextConfigEntity } from '../contact-contexts/entities/contact-context-config.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { QuotationItemEntity } from '../quotations/entities/quotation-item.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { TaskDirectoryEntity } from '../tasks/entities/task-directory.entity';
import { TaskResultFileEntity } from '../tasks/entities/task-result-file.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { UserEntity } from '../users/entities/user.entity';
import { RequirementItemEntity } from './entities/requirement-item.entity';
import { RequirementEntity } from './entities/requirement.entity';
import {
  RequirementItemsController,
  RequirementsController,
} from './requirements.controller';
import { RequirementsService } from './requirements.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RequirementEntity,
      RequirementItemEntity,
      AiExecutionLogEntity,
      TaskEntity,
      TaskDirectoryEntity,
      TaskResultFileEntity,
      CustomerEntity,
      ProjectEntity,
      UserEntity,
      ContactContextConfigEntity,
      RequirementQuotationMappingEntity,
      QuotationItemEntity,
    ]),
  ],
  controllers: [RequirementsController, RequirementItemsController],
  providers: [RequirementsService],
  exports: [RequirementsService],
})
export class RequirementsModule {}
