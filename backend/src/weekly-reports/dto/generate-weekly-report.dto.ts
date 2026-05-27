import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class GenerateWeeklyReportDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  reportWeek!: string;
}
