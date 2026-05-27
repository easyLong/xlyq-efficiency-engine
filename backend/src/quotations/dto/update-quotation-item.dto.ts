import { IsOptional, IsString } from 'class-validator';

export class UpdateQuotationItemDto {
  @IsOptional()
  @IsString()
  itemName?: string;

  @IsOptional()
  @IsString()
  pricingMode?: string;

  @IsOptional()
  @IsString()
  quantity?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  unitPrice?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  matchStatus?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
