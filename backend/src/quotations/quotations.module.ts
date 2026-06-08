import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { RequirementItemEntity } from '../requirements/entities/requirement-item.entity';
import { QuotationItemEntity } from './entities/quotation-item.entity';
import { QuotationItemDimensionRuleEntity } from './entities/quotation-item-dimension-rule.entity';
import { QuotationEntity } from './entities/quotation.entity';
import { RequirementQuotationMappingEntity } from './entities/requirement-quotation-mapping.entity';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuotationEntity,
      QuotationItemEntity,
      AiExecutionLogEntity,
      QuotationItemDimensionRuleEntity,
      RequirementQuotationMappingEntity,
      RequirementItemEntity,
    ]),
  ],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
