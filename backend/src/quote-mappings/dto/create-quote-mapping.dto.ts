import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateQuoteMappingDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  requirementItemId!: string;

  @IsOptional()
  @IsUUID()
  quotationId?: string;

  @IsOptional()
  @IsUUID()
  quotationItemId?: string;

  @IsOptional()
  @IsString()
  mappingStatus?: string;

  @IsOptional()
  @IsString()
  mappingType?: string;

  @IsOptional()
  @IsString()
  matchedRatio?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
