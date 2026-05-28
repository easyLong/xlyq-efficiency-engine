import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { CreateQuotationItemDto } from './dto/create-quotation-item.dto';
import { ImportQuotationTextDto } from './dto/import-quotation-text.dto';
import { ParseQuotationTextDto } from './dto/parse-quotation-text.dto';
import { ReviewQuotationDto } from './dto/review-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { UpdateQuotationItemDto } from './dto/update-quotation-item.dto';
import { QuotationsService } from './quotations.service';

@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.quotationsService.findAll(projectId, status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quotationsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateQuotationDto) {
    return this.quotationsService.create(dto);
  }

  @Post('import-text')
  importText(@Body() dto: ImportQuotationTextDto) {
    return this.quotationsService.importText(dto);
  }

  @Post('parse-text')
  parseText(@Body() dto: ParseQuotationTextDto) {
    return this.quotationsService.parseText(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateQuotationDto) {
    return this.quotationsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.quotationsService.remove(id);
  }

  @Get(':id/items')
  listItems(@Param('id') id: string) {
    return this.quotationsService.listItems(id);
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: CreateQuotationItemDto) {
    return this.quotationsService.addItem(id, dto);
  }

  @Patch('items/:itemId')
  updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateQuotationItemDto,
  ) {
    return this.quotationsService.updateItem(itemId, dto);
  }

  @Delete('items/:itemId')
  deleteItem(@Param('itemId') itemId: string) {
    return this.quotationsService.deleteItem(itemId);
  }

  @Post(':id/submit-review')
  submitReview(@Param('id') id: string) {
    return this.quotationsService.submitReview(id);
  }

  @Post(':id/review')
  review(@Param('id') id: string, @Body() dto: ReviewQuotationDto) {
    return this.quotationsService.review(id, dto);
  }

  @Post(':id/confirm-customer')
  confirmCustomer(@Param('id') id: string) {
    return this.quotationsService.confirmCustomer(id);
  }

  @Post(':id/export')
  export(@Param('id') id: string) {
    return this.quotationsService.export(id);
  }
}
