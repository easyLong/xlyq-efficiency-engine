import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateTaskPriceRuleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  customerCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  businessCategoryCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  secondaryCategoryCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tertiaryCategoryCode!: string;

  @IsOptional()
  @IsIn(['fixed', 'quantity', 'time_rate'])
  pricingMode?: string;

  @Matches(/^\d{1,12}(?:\.\d{1,2})?$/)
  unitPrice!: string;

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
