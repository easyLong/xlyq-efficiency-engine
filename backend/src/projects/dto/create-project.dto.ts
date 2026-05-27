import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  projectName!: string;

  @IsUUID()
  customerId!: string;

  @IsUUID()
  ownerUserId!: string;

  @IsOptional()
  @IsString()
  projectType?: string;

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
  description?: string;
}
