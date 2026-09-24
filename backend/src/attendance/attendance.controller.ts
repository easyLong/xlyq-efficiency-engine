import { Controller, Get, Query } from '@nestjs/common';
import { AdminOnly } from '../common/decorators/admin-only.decorator';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
@AdminOnly()
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('summary')
  summary(
    @Query('range') range?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.attendanceService.getSummary(
      range === 'custom' ? 'custom' : range === 'week' ? 'week' : 'month',
      startDate,
      endDate,
    );
  }
}
