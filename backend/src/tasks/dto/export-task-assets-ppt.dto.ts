import { IsOptional, IsString } from 'class-validator';

export class ExportTaskAssetsPptDto {
  @IsOptional()
  @IsString()
  taskIds?: string;
}
