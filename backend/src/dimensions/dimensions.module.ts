import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DimensionsController } from './dimensions.controller';
import { DimensionsService } from './dimensions.service';
import { BusinessCategorySecondaryCategoryEntity } from './entities/business-category-secondary-category.entity';
import { DimensionDictionaryEntity } from './entities/dimension-dictionary.entity';
import { TaskPriceRuleEntity } from './entities/task-price-rule.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DimensionDictionaryEntity,
      BusinessCategorySecondaryCategoryEntity,
      TaskPriceRuleEntity,
    ]),
  ],
  controllers: [DimensionsController],
  providers: [DimensionsService],
  exports: [DimensionsService],
})
export class DimensionsModule {}
