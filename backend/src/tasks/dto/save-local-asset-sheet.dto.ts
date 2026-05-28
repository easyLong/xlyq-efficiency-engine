import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class LocalAssetSheetAssetDto {
  @IsString()
  @IsNotEmpty()
  assetUrl!: string;
}

export class SaveLocalAssetSheetDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalAssetSheetAssetDto)
  assets!: LocalAssetSheetAssetDto[];
}
