import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ReviewQuotationDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsString()
  remark?: string;
}
