import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReturnTaskRevisionDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  progressPercent?: string;
}
