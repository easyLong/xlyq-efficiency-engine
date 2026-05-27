import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateRequirementItemDto } from './dto/create-requirement-item.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { UpdateRequirementItemDto } from './dto/update-requirement-item.dto';
import { RequirementsService } from './requirements.service';

@Controller('requirements')
export class RequirementsController {
  constructor(private readonly requirementsService: RequirementsService) {}

  @Get()
  findAll(@Query('projectId') projectId?: string) {
    return this.requirementsService.findAll(projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.requirementsService.findOne(id);
  }

  @Get(':id/items')
  findItems(@Param('id') id: string) {
    return this.requirementsService.findItems(id);
  }

  @Post()
  create(@Body() dto: CreateRequirementDto) {
    return this.requirementsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRequirementDto) {
    return this.requirementsService.update(id, dto);
  }

  @Post(':id/parse')
  parse(@Param('id') id: string) {
    return this.requirementsService.parse(id);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.requirementsService.confirm(id);
  }

  @Post(':id/items')
  createItem(
    @Param('id') id: string,
    @Body() dto: CreateRequirementItemDto,
  ) {
    return this.requirementsService.createItem(id, dto);
  }
}

@Controller('requirement-items')
export class RequirementItemsController {
  constructor(private readonly requirementsService: RequirementsService) {}

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('requirementId') requirementId?: string,
    @Query('status') status?: string,
  ) {
    return this.requirementsService.listItems(projectId, requirementId, status);
  }

  @Patch(':itemId')
  update(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateRequirementItemDto,
  ) {
    return this.requirementsService.updateItem(itemId, dto);
  }

  @Post(':itemId/confirm')
  confirm(@Param('itemId') itemId: string) {
    return this.requirementsService.confirmItem(itemId);
  }

  @Post(':itemId/obsolete')
  obsolete(@Param('itemId') itemId: string) {
    return this.requirementsService.obsoleteItem(itemId);
  }
}
