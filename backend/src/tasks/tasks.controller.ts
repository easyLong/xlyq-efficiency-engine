import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Permission } from '../common/decorators/permission.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserEntity } from '../users/entities/user.entity';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ExportTaskAssetsPptDto } from './dto/export-task-assets-ppt.dto';
import { ProvisionTaskWorkspaceDto } from './dto/provision-task-workspace.dto';
import { RegisterTaskResultFileDto } from './dto/register-task-result-file.dto';
import { SaveLocalAssetSheetDto } from './dto/save-local-asset-sheet.dto';
import { UploadLocalAssetImageDto } from './dto/upload-local-asset-image.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('assigneeUserId') assigneeUserId?: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.findAll(projectId, assigneeUserId, request?.user);
  }

  @Get('board')
  board(
    @Query('projectId') projectId?: string,
    @Query('liveAssetCount') liveAssetCount?: string,
    @Query('customerCode') customerCode?: string,
    @Query('customerId') customerId?: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.board(
      projectId,
      liveAssetCount === 'true',
      customerCode ?? customerId,
      request?.user,
    );
  }

  @Get('assets/export-ppt')
  @Permission('settlement.view_all')
  async exportAssetsPpt(
    @Query() dto: ExportTaskAssetsPptDto,
    @Res() response: Response,
  ) {
    const result = await this.tasksService.exportAssetsPpt(dto);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="assets.pptx"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    );
    response.send(result.buffer);
  }

  @Get(':id/status-history')
  listStatusHistory(
    @Param('id') id: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.listStatusHistory(id, request?.user?.id ?? null);
  }

  @Get(':id/workflow')
  getWorkflow(
    @Param('id') id: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.getWorkflow(id, request?.user?.id ?? null);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.findOneForUser(id, request?.user?.id ?? null);
  }

  @Post()
  @Permission('requirement.create')
  create(@Body() dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  @Post('from-requirement-item/:itemId')
  @Permission('requirement.create')
  createFromRequirementItem(@Param('itemId') itemId: string) {
    return this.tasksService.createFromRequirementItem(itemId);
  }

  @Patch(':id')
  @Permission('task.assign_owned')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.update(id, dto, request?.user?.id ?? null);
  }

  @Post(':id/assign')
  @Permission('task.assign_owned')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignTaskDto,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.assign(id, dto, request?.user?.id ?? null);
  }

  @Get(':id/workspace')
  getWorkspace(
    @Param('id') id: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.getWorkspace(id, request?.user?.id ?? null);
  }

  @Public()
  @Get(':id/asset-sheet/context')
  getAssetSheetContext(
    @Param('id') id: string,
    @Query('token') token?: string,
  ) {
    return this.tasksService.getAssetSheetContext(id, token);
  }

  @Public()
  @Post(':id/asset-sheet/start')
  startAssetSheetWork(@Param('id') id: string, @Query('token') token?: string) {
    return this.tasksService.startAssetSheetWork(id, token);
  }

  @Post(':id/workspace/provision')
  @Permission('task.assign_owned')
  provisionWorkspace(
    @Param('id') id: string,
    @Body() dto: ProvisionTaskWorkspaceDto,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.provisionWorkspace(
      id,
      dto,
      request?.user?.id ?? null,
    );
  }

  @Get(':id/result-files')
  listResultFiles(
    @Param('id') id: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.listResultFilesForUser(
      id,
      request?.user?.id ?? null,
    );
  }

  @Public()
  @Get(':id/asset-review/context')
  getAssetReviewContext(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Req() request: Request,
  ) {
    return this.tasksService.getAssetReviewContext(
      id,
      token,
      request.headers.authorization,
    );
  }

  @Public()
  @Post(':id/asset-review/approve')
  approveAssetReview(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Body() body: { token?: string },
    @Req() request: Request,
  ) {
    return this.tasksService.approveAssetReview(
      id,
      token ?? body?.token,
      request.headers.authorization,
    );
  }

  @Public()
  @Post(':id/asset-review/return')
  returnAssetReview(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Body() body: { token?: string; reason?: string },
    @Req() request: Request,
  ) {
    return this.tasksService.returnAssetReview(
      id,
      body?.reason ?? '',
      token ?? body?.token,
      request.headers.authorization,
    );
  }

  @Post(':id/asset-sheet/sync')
  @Permission('task.accept_owned')
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

  @Public()
  @Get(':id/progress-feedback/context')
  getProgressFeedbackContext(
    @Param('id') id: string,
    @Query('token') token?: string,
  ) {
    return this.tasksService.getProgressFeedbackContext(id, token);
  }

  @Post(':id/result-files')
  @Permission('task.submit_assigned')
  registerResultFile(
    @Param('id') id: string,
    @Body() dto: RegisterTaskResultFileDto,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.tasksService.registerResultFile(
      id,
      dto,
      request?.user?.id ?? null,
    );
  }

  @Post(':id/ai-assignment-suggestion')
  @Permission('task.assign_owned')
  aiAssignmentSuggestion(@Param('id') id: string) {
    return this.tasksService.aiAssignmentSuggestion(id);
  }
}
