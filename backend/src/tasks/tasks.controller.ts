import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('assigneeUserId') assigneeUserId?: string,
  ) {
    return this.tasksService.findAll(projectId, assigneeUserId);
  }

  @Get('board')
  board(@Query('projectId') projectId?: string) {
    return this.tasksService.board(projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  @Post('from-requirement-item/:itemId')
  createFromRequirementItem(@Param('itemId') itemId: string) {
    return this.tasksService.createFromRequirementItem(itemId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignTaskDto) {
    return this.tasksService.assign(id, dto);
  }

  @Post(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTaskStatusDto) {
    return this.tasksService.updateStatus(id, dto);
  }

  @Post(':id/ai-assignment-suggestion')
  aiAssignmentSuggestion(@Param('id') id: string) {
    return this.tasksService.aiAssignmentSuggestion(id);
  }
}
