import { IsIn, IsOptional, IsString } from 'class-validator';
import { TASK_STATUSES, TaskStatus } from '../task-status';

export class UpdateTaskStatusDto {
  @IsIn(TASK_STATUSES)
  status!: TaskStatus;

  @IsOptional()
  @IsString()
  blockedReason?: string;
}
