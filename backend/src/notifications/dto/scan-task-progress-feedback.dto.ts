import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ScanTaskProgressFeedbackDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  daysAfterStart?: string;

  @IsOptional()
  @IsString()
  repeatDays?: string;
}
