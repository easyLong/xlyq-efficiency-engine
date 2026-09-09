import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Permission } from '../common/decorators/permission.decorator';
import { UserEntity } from '../users/entities/user.entity';
import { CreateWorkReportDto } from './dto/create-work-report.dto';
import { WorkReportsService } from './work-reports.service';

@Controller('work-reports')
export class WorkReportsController {
  constructor(private readonly workReportsService: WorkReportsService) {}

  @Get('config')
  @Permission('work_report.create')
  config() {
    return this.workReportsService.getConfig();
  }

  @Get()
  @Permission('work_report.view_own')
  findAll(
    @Query('scope') scope?: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.workReportsService.findAll(request?.user ?? null, scope);
  }

  @Post()
  @Permission('work_report.create')
  create(
    @Body() dto: CreateWorkReportDto,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.workReportsService.create(dto, request?.user ?? null);
  }
}
