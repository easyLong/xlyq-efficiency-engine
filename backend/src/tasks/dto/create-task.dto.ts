import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTaskDto {
  @IsUUID()
  projectId!: string;

  @IsOptional()
  @IsUUID()
  requirementItemId?: string;

  @IsString()
  @IsNotEmpty()
  taskName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @IsOptional()
  @IsString()
  estimatedHours?: string;

  @IsOptional()
  @IsString()
  plannedEndAt?: string;
}
