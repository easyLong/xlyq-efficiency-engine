import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
