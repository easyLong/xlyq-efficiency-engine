import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SendBotMessageDto } from './dto/send-bot-message.dto';
import { FeishuService } from './feishu.service';

@Controller('integrations/feishu')
export class FeishuController {
  constructor(private readonly feishuService: FeishuService) {}

  @Get('config')
  config() {
    return this.feishuService.getConfigStatus();
  }

  @Post('send/bot-message')
  sendBotMessage(@Body() dto: SendBotMessageDto) {
    return this.feishuService.sendBotMessage(dto);
  }

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
