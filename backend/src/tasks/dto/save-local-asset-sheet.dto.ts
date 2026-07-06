import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class LocalAssetSheetAssetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  assetUrl!: string;
}

export class SaveLocalAssetSheetDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalAssetSheetAssetDto)
  assets?: LocalAssetSheetAssetDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  linkUrls?: string[];
}
