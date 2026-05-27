import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateWorklogDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  taskId!: string;

  @IsOptional()
  @IsUUID()
  requirementItemId?: string;

  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  workDate!: string;

  @IsString()
  @IsNotEmpty()
  hours!: string;

  @IsOptional()
  @IsString()
  workSummary?: string;

  @IsOptional()
  @IsString()
  source?: string;
}
