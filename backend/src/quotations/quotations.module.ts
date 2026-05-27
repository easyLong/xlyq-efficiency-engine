import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuotationItemEntity } from './entities/quotation-item.entity';
import { QuotationEntity } from './entities/quotation.entity';
import { RequirementQuotationMappingEntity } from './entities/requirement-quotation-mapping.entity';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuotationEntity,
      QuotationItemEntity,
      RequirementQuotationMappingEntity,
    ]),
  ],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
