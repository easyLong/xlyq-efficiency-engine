import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  taskName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  urgencyLevel?: string;

  @IsOptional()
  @IsString()
  plannedStartAt?: string;

  @IsOptional()
  @IsString()
  plannedEndAt?: string;

  @IsOptional()
  @IsString()
  estimatedHours?: string;

  @IsOptional()
  @Matches(/^\d{1,8}(?:\.\d{1,2})?$/)
  contributionPoints?: string;

  @IsOptional()
  @Matches(/^\d{1,12}(?:\.\d{1,2})?$/, {
    message: 'priceAmount must be a non-negative amount with up to 2 decimals',
  })
  priceAmount?: string;
}
