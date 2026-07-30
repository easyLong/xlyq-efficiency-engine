import { Global, Module } from '@nestjs/common';
import { BusinessCalendarController } from './business-calendar.controller';
import { BusinessCalendarService } from './business-calendar.service';

@Global()
@Module({
  controllers: [BusinessCalendarController],
  providers: [BusinessCalendarService],
  exports: [BusinessCalendarService],
})
export class BusinessCalendarModule {}
