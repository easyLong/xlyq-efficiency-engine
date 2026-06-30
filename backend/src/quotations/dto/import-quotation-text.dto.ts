import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class ImportQuotationTextDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  customerCode!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  contractStartMonth?: string;

  @IsOptional()
  @IsString()
  contractEndMonth?: string;

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
