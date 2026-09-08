import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpsertDimensionDictionaryDto {
  @IsString()
  @MaxLength(32)
  dimensionType!: string;

  @IsString()
  @MaxLength(64)
  dimensionCode!: string;

  @IsString()
  @MaxLength(128)
  dimensionName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  productType?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentCode?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null;

  @IsOptional()
  @Matches(/^\d{1,6}(?:\.\d{1,2})?$/)
  estimatedHours?: string | null;

  @IsOptional()
  @Matches(/^\d{1,8}(?:\.\d{1,2})?$/)
  contributionPoints?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  measureUnit?: string | null;

  @IsOptional()
  @IsString()
  contentScope?: string | null;

  @IsOptional()
  @IsString()
  deliveryStandard?: string | null;

  @IsOptional()
  @IsString()
  scoringBoundary?: string | null;

  @IsOptional()
  @IsInt()
  referenceMinutes?: number | null;
}
