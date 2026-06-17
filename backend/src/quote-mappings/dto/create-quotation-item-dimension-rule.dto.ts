import { IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateQuotationItemDimensionRuleDto {
  @IsUUID()
  quotationItemId!: string;

  @IsOptional()
  @IsString()
  customerCode?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  businessPlatform?: string;

  @IsOptional()
  @IsString()
  businessCategory?: string;

  @IsOptional()
  @IsString()
  secondaryCategory?: string;

  @IsOptional()
  @IsString()
  tertiaryCategory?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
