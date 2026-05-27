import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ScanFeishuSyncFailuresDto } from './dto/scan-feishu-sync-failures.dto';
import { ScanTaskDeadlinesDto } from './dto/scan-task-deadlines.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SendWorklogRemindersDto } from './dto/send-worklog-reminders.dto';
import { TaskNotificationDto } from './dto/task-notification.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(
    @Query('recipientUserId') recipientUserId?: string,
    @Query('status') status?: string,
  ) {
    return this.notificationsService.findAll(recipientUserId, status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.notificationsService.findOne(id);
  }

  @Post('send')
  send(@Body() dto: SendNotificationDto) {
    return this.notificationsService.send(dto);
  }

  @Post('task-assignment')
  taskAssignment(@Body() dto: TaskNotificationDto) {
    return this.notificationsService.notifyTaskAssignedById(
      dto.taskId,
      dto.message,
    );
  }

  @Post('task-deadline-scan')
  taskDeadlineScan(@Body() dto: ScanTaskDeadlinesDto) {
    return this.notificationsService.scanTaskDeadlines(dto);
  }

  @Post('worklog-reminders')
  worklogReminders(@Body() dto: SendWorklogRemindersDto) {
    return this.notificationsService.sendWorklogReminders(dto);
  }

  @Post('feishu-sync-failure-scan')
  feishuSyncFailureScan(@Body() dto: ScanFeishuSyncFailuresDto) {
    return this.notificationsService.scanFeishuSyncFailures(dto);
  }

  @Post(':id/read')
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }
}
