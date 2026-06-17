import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateQuotationDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  customerCode!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

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
