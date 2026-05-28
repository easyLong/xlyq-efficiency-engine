import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  projectName?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  projectType?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  budgetAmount?: string;

  @IsOptional()
  @IsString()
  plannedEndDate?: string;

  @IsOptional()
  @IsString()
  actualEndDate?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
