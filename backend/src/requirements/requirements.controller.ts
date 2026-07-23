import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Permission } from '../common/decorators/permission.decorator';
import { AiMatchRequirementContextDto } from './dto/ai-match-requirement-context.dto';
import { AiSplitRequirementsDto } from './dto/ai-split-requirements.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateRequirementWithTaskDto } from './dto/create-requirement-with-task.dto';
import { CreateRequirementItemDto } from './dto/create-requirement-item.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { UpdateRequirementItemDto } from './dto/update-requirement-item.dto';
import { RequirementsService } from './requirements.service';
import { UserEntity } from '../users/entities/user.entity';

@Controller('requirements')
export class RequirementsController {
  constructor(private readonly requirementsService: RequirementsService) {}

  @Get()
  findAll(@Query('projectId') projectId?: string) {
    return this.requirementsService.findAll(projectId);
  }

  @Get('history-board')
  historyBoard(@Req() request?: Request & { user?: UserEntity }) {
    return this.requirementsService.historyBoard(request?.user ?? null);
  }

  @Get('ai-preview-candidates')
  aiPreviewCandidates(
    @Query('limit') limit?: string,
    @Query('scope') scope?: string,
    @Query('reviewOwnerId') reviewOwnerId?: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.requirementsService.listAiPreviewCandidates(
      limit ? Number(limit) : 12,
      scope,
      request?.user ?? null,
      reviewOwnerId,
    );
  }

  @Get('business-category-owners')
  businessCategoryOwners() {
    return this.requirementsService.listBusinessCategoryOwners();
  }

  @Patch('business-category-owners/:categoryCode')
  updateBusinessCategoryOwner(
    @Param('categoryCode') categoryCode: string,
    @Body() dto: { ownerUserId?: string | null },
  ) {
    return this.requirementsService.updateBusinessCategoryOwner(
      categoryCode,
      dto,
    );
  }

  @Post('ai-preview-candidates/:candidateId/confirm')
  @Permission('ai_preview.confirm_owned')
  confirmAiPreviewCandidate(
    @Param('candidateId') candidateId: string,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.requirementsService.confirmAiPreviewCandidate(
      candidateId,
      request?.user ?? null,
    );
  }

  @Post('ai-preview-candidates/:candidateId/reject')
  @Permission('ai_preview.confirm_owned')
  rejectAiPreviewCandidate(
    @Param('candidateId') candidateId: string,
    @Body()
    dto: {
      rejectReasons?: unknown;
      rejectNote?: unknown;
      useForPromptOptimization?: unknown;
    },
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.requirementsService.rejectAiPreviewCandidate(
      candidateId,
      request?.user ?? null,
      dto,
    );
  }

  @Post('ai-preview-candidates/:candidateId/copy')
  @Permission('ai_preview.confirm_owned')
  copyAiPreviewCandidate(
    @Param('candidateId') candidateId: string,
    @Body() dto: { targetBusinessCategory?: string },
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.requirementsService.copyAiPreviewCandidate(
      candidateId,
      dto?.targetBusinessCategory,
      request?.user ?? null,
    );
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
  @Permission('requirement.create')
  create(@Body() dto: CreateRequirementDto) {
    return this.requirementsService.create(dto);
  }

  @Post('with-task')
  @Permission('requirement.create')
  createWithTask(
    @Body() dto: CreateRequirementWithTaskDto,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.requirementsService.createWithTask(
      dto,
      request?.user ?? null,
    );
  }

  @Post('ai-split-with-tasks')
  @Permission('requirement.create')
  aiSplitWithTasks(
    @Body() dto: AiSplitRequirementsDto,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.requirementsService.aiSplitWithTasks(
      dto,
      request?.user ?? null,
    );
  }

  @Post('ai-match-context')
  aiMatchContext(@Body() dto: AiMatchRequirementContextDto) {
    return this.requirementsService.aiMatchContext(dto);
  }

  @Patch(':id')
  @Permission('requirement.edit_owned')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
    @Req() request?: Request & { user?: UserEntity },
  ) {
    return this.requirementsService.update(
      id,
      dto,
      request?.user ?? null,
    );
  }

  @Delete(':id/bundle')
  @Permission('requirement.delete_all')
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
  createItem(@Param('id') id: string, @Body() dto: CreateRequirementItemDto) {
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
