import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class UpdateSourceContactContextDto {
  @IsOptional()
  @IsString()
  sourceName?: string;

  @IsOptional()
  @IsString()
  externalSourceId?: string;

  @IsOptional()
  @IsUUID()
  contactContextConfigId?: string;

  @IsOptional()
  @IsString()
  status?: string;

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
