import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';

export class UpdateEmployeeStatusDto {
  @IsIn(['active', 'departed'])
  employmentStatus!: 'active' | 'departed';

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  departedAt?: string | null;
}
