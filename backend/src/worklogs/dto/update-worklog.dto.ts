import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateWorklogDto {
  @IsOptional()
  @IsUUID()
  requirementItemId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  workDate?: string;

  @IsOptional()
  @IsString()
  hours?: string;

  @IsOptional()
  @IsString()
  workSummary?: string;

  @IsOptional()
  @IsString()
  approvalStatus?: string;
}
