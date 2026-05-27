import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  taskName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @IsOptional()
  @IsString()
  plannedEndAt?: string;

  @IsOptional()
  @IsString()
  actualEndAt?: string;

  @IsOptional()
  @IsString()
  estimatedHours?: string;

  @IsOptional()
  @IsString()
  progressPercent?: string;

  @IsOptional()
  @IsString()
  blockedReason?: string;
}
