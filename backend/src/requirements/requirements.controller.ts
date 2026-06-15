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
import { AiMatchRequirementContextDto } from './dto/ai-match-requirement-context.dto';
import { AiSplitRequirementsDto } from './dto/ai-split-requirements.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateRequirementWithTaskDto } from './dto/create-requirement-with-task.dto';
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

  @Get('history-board')
  historyBoard() {
    return this.requirementsService.historyBoard();
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

  @Post('with-task')
  createWithTask(@Body() dto: CreateRequirementWithTaskDto) {
    return this.requirementsService.createWithTask(dto);
  }

  @Post('ai-split-with-tasks')
  aiSplitWithTasks(@Body() dto: AiSplitRequirementsDto) {
    return this.requirementsService.aiSplitWithTasks(dto);
  }

  @Post('ai-match-context')
  aiMatchContext(@Body() dto: AiMatchRequirementContextDto) {
    return this.requirementsService.aiMatchContext(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRequirementDto) {
    return this.requirementsService.update(id, dto);
  }

  @Delete(':id/bundle')
  removeBundle(@Param('id') id: string) {
    return this.requirementsService.removeBundle(id);
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
