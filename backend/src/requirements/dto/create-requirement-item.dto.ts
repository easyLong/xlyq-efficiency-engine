import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateRequirementItemDto {
  @IsOptional()
  @IsUUID()
  parentItemId?: string;

  @IsString()
  @IsNotEmpty()
  itemTitle!: string;

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
}
