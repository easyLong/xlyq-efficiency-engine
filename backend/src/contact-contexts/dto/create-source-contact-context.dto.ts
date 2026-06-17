import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateSourceContactContextDto {
  @IsOptional()
  @IsString()
  sourceApp?: string;

  @IsString()
  @IsNotEmpty()
  sourceType!: string;

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsString()
  @IsNotEmpty()
  sourceName!: string;

  @IsOptional()
  @IsString()
  externalSourceId?: string;

  @IsUUID()
  contactContextConfigId!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsString()
  matchMethod?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
