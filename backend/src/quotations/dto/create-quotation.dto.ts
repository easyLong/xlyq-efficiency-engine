import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateQuotationDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsString()
  pricingBasis?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  quotationNo?: string;
}
