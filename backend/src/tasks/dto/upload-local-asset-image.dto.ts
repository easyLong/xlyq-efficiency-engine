import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadLocalAssetImageDto {
  @IsString()
  dataUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  fileName?: string;
}
