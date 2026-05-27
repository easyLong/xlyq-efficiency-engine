import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
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
    ]),
  ],
  controllers: [RequirementsController, RequirementItemsController],
  providers: [RequirementsService],
  exports: [RequirementsService],
})
export class RequirementsModule {}
