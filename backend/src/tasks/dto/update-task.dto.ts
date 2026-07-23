import { IsOptional, IsString } from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  taskName?: string;

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
  plannedStartAt?: string;

  @IsOptional()
  @IsString()
  plannedEndAt?: string;

  @IsOptional()
  @IsString()
  estimatedHours?: string;
}
