import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { GenerateWeeklyReportDto } from './dto/generate-weekly-report.dto';
import { UpdateWeeklyReportDto } from './dto/update-weekly-report.dto';
import { WeeklyReportsService } from './weekly-reports.service';

@Controller('weekly-reports')
export class WeeklyReportsController {
  constructor(private readonly weeklyReportsService: WeeklyReportsService) {}

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('reportWeek') reportWeek?: string,
    @Query('status') status?: string,
  ) {
    return this.weeklyReportsService.findAll(projectId, reportWeek, status);
  }

  @Get(':reportId')
  findOne(@Param('reportId') reportId: string) {
    return this.weeklyReportsService.findOne(reportId);
  }

  @Post('generate')
  generate(@Body() dto: GenerateWeeklyReportDto) {
    return this.weeklyReportsService.generate(dto);
  }

  @Patch(':reportId')
  update(
    @Param('reportId') reportId: string,
    @Body() dto: UpdateWeeklyReportDto,
  ) {
    return this.weeklyReportsService.update(reportId, dto);
  }

  @Post(':reportId/send-feishu')
  sendFeishu(@Param('reportId') reportId: string) {
    return this.weeklyReportsService.sendFeishu(reportId);
  }
}
