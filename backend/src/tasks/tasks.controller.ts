import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ProvisionTaskWorkspaceDto } from './dto/provision-task-workspace.dto';
import { RegisterTaskResultFileDto } from './dto/register-task-result-file.dto';
import { ReturnTaskRevisionDto } from './dto/return-task-revision.dto';
import { SaveLocalAssetSheetDto } from './dto/save-local-asset-sheet.dto';
import { UploadLocalAssetImageDto } from './dto/upload-local-asset-image.dto';
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
  board(
    @Query('projectId') projectId?: string,
    @Query('liveAssetCount') liveAssetCount?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.tasksService.board(
      projectId,
      liveAssetCount === 'true',
      customerId,
    );
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

  @Get(':id/workspace')
  getWorkspace(@Param('id') id: string) {
    return this.tasksService.getWorkspace(id);
  }

  @Public()
  @Get(':id/asset-sheet/context')
  getAssetSheetContext(@Param('id') id: string, @Query('token') token?: string) {
    return this.tasksService.getAssetSheetContext(id, token);
  }

  @Post(':id/workspace/provision')
  provisionWorkspace(
    @Param('id') id: string,
    @Body() dto: ProvisionTaskWorkspaceDto,
  ) {
    return this.tasksService.provisionWorkspace(id, dto);
  }

  @Get(':id/result-files')
  listResultFiles(@Param('id') id: string) {
    return this.tasksService.listResultFiles(id);
  }

  @Post(':id/asset-sheet/sync')
  syncAssetSheet(@Param('id') id: string) {
    return this.tasksService.syncAssetSheet(id);
  }

  @Public()
  @Post(':id/asset-sheet/local-assets')
  saveLocalAssetSheet(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Body() dto: SaveLocalAssetSheetDto,
  ) {
    return this.tasksService.saveLocalAssetSheet(id, dto, token);
  }

  @Public()
  @Post(':id/asset-sheet/upload-image')
  uploadLocalAssetImage(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Body() dto: UploadLocalAssetImageDto,
  ) {
    return this.tasksService.uploadLocalAssetImage(id, dto, token);
  }

  @Post(':id/result-files')
  registerResultFile(
    @Param('id') id: string,
    @Body() dto: RegisterTaskResultFileDto,
  ) {
    return this.tasksService.registerResultFile(id, dto);
  }

  @Post(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTaskStatusDto) {
    return this.tasksService.updateStatus(id, dto);
  }

  @Post(':id/return-revision')
  returnRevision(@Param('id') id: string, @Body() dto: ReturnTaskRevisionDto) {
    return this.tasksService.returnRevision(id, dto);
  }

  @Post(':id/ai-assignment-suggestion')
  aiAssignmentSuggestion(@Param('id') id: string) {
    return this.tasksService.aiAssignmentSuggestion(id);
  }
}
