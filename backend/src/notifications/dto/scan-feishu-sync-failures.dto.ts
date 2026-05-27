import { IsOptional, IsString } from 'class-validator';

export class ScanFeishuSyncFailuresDto {
  @IsOptional()
  @IsString()
  hours?: string;
}
