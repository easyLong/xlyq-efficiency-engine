import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SendAppMessageDto } from './dto/send-app-message.dto';
import { SendBotMessageDto } from './dto/send-bot-message.dto';
import { SyncFeishuUsersDto } from './dto/sync-feishu-users.dto';
import { FeishuService } from './feishu.service';

@Controller('integrations/feishu')
export class FeishuController {
  constructor(private readonly feishuService: FeishuService) {}

  @Public()
  @Get('config')
  config() {
    return this.feishuService.getConfigStatus();
  }

  @Post('send/bot-message')
  sendBotMessage(@Body() dto: SendBotMessageDto) {
    return this.feishuService.sendBotMessage(dto);
  }

  @Post('send/app-message')
  sendAppMessage(@Body() dto: SendAppMessageDto) {
    return this.feishuService.sendAppMessage(dto);
  }

  @Post('contacts/sync-users')
  syncUsers(@Body() dto: SyncFeishuUsersDto) {
    return this.feishuService.syncUsers(dto);
  }

  @Public()
  @Post('webhook/events')
  webhook(@Body() body: Record<string, unknown>) {
    return this.feishuService.handleWebhookEvent(body);
  }

  @Get('sync-logs')
  syncLogs(
    @Query('objectType') objectType?: string,
    @Query('objectId') objectId?: string,
    @Query('status') status?: string,
  ) {
    return this.feishuService.listSyncLogs(objectType, objectId, status);
  }
}
