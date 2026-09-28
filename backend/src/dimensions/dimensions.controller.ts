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
import { CreateTaskPriceRuleDto } from './dto/create-task-price-rule.dto';
import { UpdateTaskPriceRuleDto } from './dto/update-task-price-rule.dto';
import { DimensionsService } from './dimensions.service';
import { Permission } from '../common/decorators/permission.decorator';

@Controller('dimensions')
export class DimensionsController {
  constructor(private readonly dimensionsService: DimensionsService) {}

  @Get()
  @Permission('page.standard_config')
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
    return this.dimensionsService.findBusinessCategorySecondaryRelations(
      status,
    );
  }

  @Get('category-tree')
  categoryTree() {
    return this.dimensionsService.categoryTree();
  }

  @Get('task-price-rules')
  @Permission('page.standard_config')
  taskPriceRules(
    @Query('customerCode') customerCode?: string,
    @Query('status') status = 'active',
  ) {
    return this.dimensionsService.findTaskPriceRules({ customerCode, status });
  }

  @Post('task-price-rules')
  @Permission('page.standard_config')
  createTaskPriceRule(@Body() dto: CreateTaskPriceRuleDto) {
    return this.dimensionsService.createTaskPriceRule(dto);
  }

  @Patch('task-price-rules/:id')
  @Permission('page.standard_config')
  updateTaskPriceRule(
    @Param('id') id: string,
    @Body() dto: UpdateTaskPriceRuleDto,
  ) {
    return this.dimensionsService.updateTaskPriceRule(id, dto);
  }

  @Post()
  @Permission('page.standard_config')
  upsert(@Body() dto: UpsertDimensionDictionaryDto) {
    return this.dimensionsService.upsert(dto);
  }

  @Patch(':id')
  @Permission('page.standard_config')
  update(@Param('id') id: string, @Body() dto: UpdateDimensionDictionaryDto) {
    return this.dimensionsService.update(id, dto);
  }
}
