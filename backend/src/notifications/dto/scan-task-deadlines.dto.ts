import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ScanTaskDeadlinesDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  daysAhead?: string;
}
