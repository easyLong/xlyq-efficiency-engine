import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Permission } from '../common/decorators/permission.decorator';
import { SettlementService } from './settlement.service';
import type { SettlementFilters } from './settlement.service';

@Controller('settlement')
@Permission('settlement.view_all')
export class SettlementController {
  constructor(private readonly service: SettlementService) {}

  @Get('templates')
  templates(@Query('customerCode') customerCode: string) {
    return this.service.listTemplates(customerCode);
  }

  @Get('templates/:id/preview')
  preview(
    @Param('id') id: string,
    @Query() filters: SettlementFilters,
    @Query('page') page?: string,
  ) {
    return this.service.preview(id, filters, Number(page) || 1);
  }

  @Get('templates/:id/export')
  async export(
    @Param('id') id: string,
    @Query() filters: SettlementFilters,
    @Res() response: Response,
  ) {
    const result = await this.service.exportExcel(id, filters);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="settlement.xlsx"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    );
    response.setHeader('X-Settlement-Row-Count', String(result.total));
    response.send(result.buffer);
  }
}
