import { Controller, Get, Query } from '@nestjs/common';
import { AdminOnly } from '../common/decorators/admin-only.decorator';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
@AdminOnly()
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('summary')
  summary(@Query('range') range?: string) {
    return this.attendanceService.getSummary(
      range === 'week' ? 'week' : 'month',
    );
  }
}
