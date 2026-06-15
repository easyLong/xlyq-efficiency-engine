import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UpdateDimensionDictionaryDto } from './dto/update-dimension-dictionary.dto';
import { UpsertDimensionDictionaryDto } from './dto/upsert-dimension-dictionary.dto';
import { DimensionsService } from './dimensions.service';

@Controller('dimensions')
export class DimensionsController {
  constructor(private readonly dimensionsService: DimensionsService) {}

  @Get()
  findAll(
    @Query('type') dimensionType?: string,
    @Query('parentCode') parentCode?: string,
    @Query('status') status = 'active',
  ) {
    return this.dimensionsService.findAll({
      dimensionType,
      parentCode,
      status,
    });
  }

  @Get('grouped')
  grouped() {
    return this.dimensionsService.grouped();
  }

  @Get('business-category-relations')
  businessCategoryRelations(@Query('status') status = 'active') {
    return this.dimensionsService.findBusinessCategorySecondaryRelations(status);
  }

  @Post()
  upsert(@Body() dto: UpsertDimensionDictionaryDto) {
    return this.dimensionsService.upsert(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDimensionDictionaryDto) {
    return this.dimensionsService.update(id, dto);
  }
}
