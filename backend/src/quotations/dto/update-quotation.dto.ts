import { IsOptional, IsString } from 'class-validator';

export class UpdateQuotationDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  pricingBasis?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
