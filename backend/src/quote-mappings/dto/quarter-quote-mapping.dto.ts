import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class QuarterQuoteMappingDto {
  @IsString()
  customerCode!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString()
  quarter!: string;

  @IsOptional()
  @IsUUID()
  quotationId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  requirementItemIds?: string[];
}
