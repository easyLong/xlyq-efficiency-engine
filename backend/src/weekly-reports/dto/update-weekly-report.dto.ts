import { IsOptional, IsString } from 'class-validator';

export class UpdateWeeklyReportDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
