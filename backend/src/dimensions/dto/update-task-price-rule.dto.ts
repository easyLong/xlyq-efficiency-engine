import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateTaskPriceRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  customerCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  businessCategoryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  secondaryCategoryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tertiaryCategoryCode?: string;

  @IsOptional()
  @IsIn(['fixed', 'quantity', 'time_rate'])
  pricingMode?: string;

  @IsOptional()
  @Matches(/^\d{1,12}(?:\.\d{1,2})?$/)
  unitPrice?: string;

  @IsOptional()
  @IsString()
  effectiveFrom?: string | null;

  @IsOptional()
  @IsString()
  effectiveTo?: string | null;

  @IsOptional()
  @IsInt()
  versionNo?: number;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;

  @IsOptional()
  @IsString()
  remark?: string | null;
}
