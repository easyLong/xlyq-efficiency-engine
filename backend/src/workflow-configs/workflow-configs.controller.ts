import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { AdminOnly } from '../common/decorators/admin-only.decorator';
import { ReplaceWorkflowMembersDto } from './dto/replace-workflow-members.dto';
import { WorkflowConfigsService } from './workflow-configs.service';

@AdminOnly()
@Controller('workflow-config')
export class WorkflowConfigsController {
  constructor(
    private readonly workflowConfigsService: WorkflowConfigsService,
  ) {}

  @Get()
  getConfiguration() {
    return this.workflowConfigsService.findAll();
  }

  @Put('customer-dispatchers/:customerCode')
  replaceCustomerDispatchers(
    @Param('customerCode') customerCode: string,
    @Body() dto: ReplaceWorkflowMembersDto,
  ) {
    return this.workflowConfigsService.replaceCustomerMembers(
      customerCode,
      'dispatcher',
      dto.userIds,
    );
  }

  @Put('product-reviewers/:reviewType')
  replaceProductReviewers(
    @Param('reviewType') reviewType: string,
    @Body() dto: ReplaceWorkflowMembersDto,
  ) {
    return this.workflowConfigsService.replaceBusinessCategoryReviewers(
      reviewType,
      dto.userIds,
    );
  }

  @Put('customer-reviewers/:customerCode')
  replaceCustomerReviewers(
    @Param('customerCode') customerCode: string,
    @Body() dto: ReplaceWorkflowMembersDto,
  ) {
    return this.workflowConfigsService.replaceCustomerMembers(
      customerCode,
      'customer_reviewer',
      dto.userIds,
    );
  }
}
