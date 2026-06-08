import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ContactContextsService } from './contact-contexts.service';
import { CreateContactContextConfigDto } from './dto/create-contact-context-config.dto';
import { UpdateContactContextConfigDto } from './dto/update-contact-context-config.dto';

@Controller('contact-contexts')
export class ContactContextsController {
  constructor(private readonly contactContextsService: ContactContextsService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.contactContextsService.findAll(status, customerId, keyword);
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
