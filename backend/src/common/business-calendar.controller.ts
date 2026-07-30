import { Controller, Get, Query } from '@nestjs/common';
import { BusinessCalendarService } from './business-calendar.service';

@Controller('business-calendar')
export class BusinessCalendarController {
  constructor(private readonly businessCalendar: BusinessCalendarService) {}

  @Get('range')
  range(@Query('start') start?: string, @Query('end') end?: string) {
    const today = this.businessCalendar.startOfLocalDay();
    const fallbackStart = today
      ? this.businessCalendar.toDateKey(today)
      : this.businessCalendar.toDateKey(new Date());
    const fallbackEnd = today
      ? this.businessCalendar.toDateKey(
          new Date(today.getFullYear(), today.getMonth() + 6, today.getDate()),
        )
      : fallbackStart;
    return this.businessCalendar.workdayRange(
      start || fallbackStart,
      end || fallbackEnd,
    );
  }
}
