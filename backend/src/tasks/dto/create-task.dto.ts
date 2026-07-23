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
  @IsString()
  urgencyLevel?: string;

  @IsOptional()
  @IsString()
  estimatedHours?: string;

  @IsOptional()
  @IsString()
  plannedStartAt?: string;

  @IsOptional()
  @IsString()
  plannedEndAt?: string;
}
