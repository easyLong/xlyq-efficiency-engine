import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { BatchConfirmQuoteMappingsDto } from './dto/batch-confirm-quote-mappings.dto';
import { CreateQuotationItemDimensionRuleDto } from './dto/create-quotation-item-dimension-rule.dto';
import { CreateQuoteMappingDto } from './dto/create-quote-mapping.dto';
import { QuarterQuoteMappingDto } from './dto/quarter-quote-mapping.dto';
import { UpdateQuotationItemDimensionRuleDto } from './dto/update-quotation-item-dimension-rule.dto';
import { UpdateQuoteMappingDto } from './dto/update-quote-mapping.dto';
import { QuoteMappingsService } from './quote-mappings.service';

@Controller('quote-mappings')
export class QuoteMappingsController {
  constructor(private readonly quoteMappingsService: QuoteMappingsService) {}

  @Get('workbench')
  workbench(@Query('projectId') projectId: string) {
    return this.quoteMappingsService.workbench(projectId);
  }

  @Post('suggest')
  suggest(@Body('projectId') projectId: string) {
    return this.quoteMappingsService.suggest(projectId);
  }

  @Get('quarter-workbench')
  quarterWorkbench(
    @Query('customerId') customerId: string,
    @Query('quarter') quarter: string,
    @Query('quotationId') quotationId?: string,
  ) {
    return this.quoteMappingsService.quarterWorkbench(
      customerId,
      quarter,
      quotationId,
    );
  }

  @Get('quarter-workbenches')
  quarterWorkbenches(
    @Query('customerIds') customerIds: string,
    @Query('quarter') quarter: string,
  ) {
    return this.quoteMappingsService.quarterWorkbenches(
      (customerIds || '').split(','),
      quarter,
    );
  }

  @Post('quarter-suggest')
  quarterSuggest(@Body() dto: QuarterQuoteMappingDto) {
    return this.quoteMappingsService.quarterSuggest(dto);
  }

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('requirementItemId') requirementItemId?: string,
    @Query('mappingStatus') mappingStatus?: string,
  ) {
    return this.quoteMappingsService.findAll(
      projectId,
      requirementItemId,
      mappingStatus,
    );
  }

  @Get('dimension-rules')
  findDimensionRules(
    @Query('quotationItemId') quotationItemId?: string,
    @Query('quotationId') quotationId?: string,
  ) {
    return this.quoteMappingsService.findDimensionRules(
      quotationItemId,
      quotationId,
    );
  }

  @Post('dimension-rules')
  createDimensionRule(@Body() dto: CreateQuotationItemDimensionRuleDto) {
    return this.quoteMappingsService.createDimensionRule(dto);
  }

  @Patch('dimension-rules/:ruleId')
  updateDimensionRule(
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateQuotationItemDimensionRuleDto,
  ) {
    return this.quoteMappingsService.updateDimensionRule(ruleId, dto);
  }

  @Delete('dimension-rules/:ruleId')
  removeDimensionRule(@Param('ruleId') ruleId: string) {
    return this.quoteMappingsService.removeDimensionRule(ruleId);
  }

  @Post()
  create(@Body() dto: CreateQuoteMappingDto) {
    return this.quoteMappingsService.create(dto);
  }

  @Patch(':mappingId')
  update(
    @Param('mappingId') mappingId: string,
    @Body() dto: UpdateQuoteMappingDto,
  ) {
    return this.quoteMappingsService.update(mappingId, dto);
  }

  @Delete(':mappingId')
  remove(@Param('mappingId') mappingId: string) {
    return this.quoteMappingsService.remove(mappingId);
  }

  @Post(':mappingId/confirm')
  confirm(@Param('mappingId') mappingId: string) {
    return this.quoteMappingsService.confirm(mappingId);
  }

  @Post('batch-confirm')
  batchConfirm(@Body() dto: BatchConfirmQuoteMappingsDto) {
    return this.quoteMappingsService.batchConfirm(dto);
  }

  @Get('diff/by-project/:projectId')
  diff(@Param('projectId') projectId: string) {
    return this.quoteMappingsService.diff(projectId);
  }
}
