import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class ImportQuotationTextDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  customerId!: string;

  @IsString()
  @IsNotEmpty()
  rawContent!: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  pricingBasis?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
