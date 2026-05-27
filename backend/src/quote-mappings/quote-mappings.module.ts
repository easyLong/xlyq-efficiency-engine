import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { QuotationItemEntity } from '../quotations/entities/quotation-item.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { QuoteMappingsController } from './quote-mappings.controller';
import { QuoteMappingsService } from './quote-mappings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RequirementQuotationMappingEntity,
      RequirementItemEntity,
      QuotationItemEntity,
      WorklogEntity,
      AiExecutionLogEntity,
    ]),
  ],
  controllers: [QuoteMappingsController],
  providers: [QuoteMappingsService],
})
export class QuoteMappingsModule {}
