import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateRequirementItemDto {
  @IsOptional()
  @IsUUID()
  parentItemId?: string;

  @IsOptional()
  @IsString()
  itemTitle?: string;

  @IsOptional()
  @IsString()
  itemDescription?: string;

  @IsOptional()
  @IsString()
  businessGoal?: string;

  @IsOptional()
  @IsString()
  acceptanceCriteria?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  estimatedHours?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  quoteScopeStatus?: string;
}
