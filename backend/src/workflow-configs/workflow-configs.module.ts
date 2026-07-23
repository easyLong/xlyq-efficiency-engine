import { Module } from '@nestjs/common';
import { WorkflowConfigsController } from './workflow-configs.controller';
import { WorkflowConfigsService } from './workflow-configs.service';

@Module({
  controllers: [WorkflowConfigsController],
  providers: [WorkflowConfigsService],
  exports: [WorkflowConfigsService],
})
export class WorkflowConfigsModule {}
