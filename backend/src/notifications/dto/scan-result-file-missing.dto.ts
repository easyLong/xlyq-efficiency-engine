import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ScanResultFileMissingDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  statuses?: string;
}
