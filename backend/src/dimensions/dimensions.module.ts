import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DimensionsController } from './dimensions.controller';
import { DimensionsService } from './dimensions.service';
import { BusinessCategorySecondaryCategoryEntity } from './entities/business-category-secondary-category.entity';
import { DimensionDictionaryEntity } from './entities/dimension-dictionary.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DimensionDictionaryEntity,
      BusinessCategorySecondaryCategoryEntity,
    ]),
  ],
  controllers: [DimensionsController],
  providers: [DimensionsService],
  exports: [DimensionsService],
})
export class DimensionsModule {}
