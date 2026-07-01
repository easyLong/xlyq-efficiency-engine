import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ContactContextsService } from './contact-contexts.service';
import { CreateContactContextConfigDto } from './dto/create-contact-context-config.dto';
import { CreateSourceContactContextDto } from './dto/create-source-contact-context.dto';
import { CreateWechatGroupConfigDto } from './dto/create-wechat-group-config.dto';
import { UpdateContactContextConfigDto } from './dto/update-contact-context-config.dto';
import { UpdateSourceContactContextDto } from './dto/update-source-contact-context.dto';
import { UpdateWechatGroupConfigDto } from './dto/update-wechat-group-config.dto';

@Controller('contact-contexts')
export class ContactContextsController {
  constructor(private readonly contactContextsService: ContactContextsService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('customerCode') customerCode?: string,
    @Query('customerId') customerId?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.contactContextsService.findAll(
      status,
      customerCode ?? customerId,
      keyword,
    );
  }

  @Get('wechat-groups')
  wechatGroupConfigs(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.contactContextsService.listWechatGroupConfigs(status, keyword);
  }

  @Post('wechat-groups')
  createWechatGroupConfig(@Body() dto: CreateWechatGroupConfigDto) {
    return this.contactContextsService.createWechatGroupConfig(dto);
  }

  @Patch('wechat-groups/:id')
  updateWechatGroupConfig(
    @Param('id') id: string,
    @Body() dto: UpdateWechatGroupConfigDto,
  ) {
    return this.contactContextsService.updateWechatGroupConfig(id, dto);
  }

  @Delete('wechat-groups/:id')
  deleteWechatGroupConfig(@Param('id') id: string) {
    return this.contactContextsService.deleteWechatGroupConfig(id);
  }

  @Get('sources')
  sourceContexts(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.contactContextsService.listSourceContexts(status, keyword);
  }

  @Post('sources')
  createSourceContext(@Body() dto: CreateSourceContactContextDto) {
    return this.contactContextsService.createSourceContext(dto);
  }

  @Patch('sources/:id')
  updateSourceContext(
    @Param('id') id: string,
    @Body() dto: UpdateSourceContactContextDto,
  ) {
    return this.contactContextsService.updateSourceContext(id, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contactContextsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateContactContextConfigDto) {
    return this.contactContextsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContactContextConfigDto,
  ) {
    return this.contactContextsService.update(id, dto);
  }
}
