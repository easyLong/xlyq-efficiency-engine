import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateContactContextConfigDto {
  @IsOptional()
  @IsString()
  groupKey?: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsString()
  @IsNotEmpty()
  contactName!: string;

  @IsOptional()
  @IsString()
  contactMobile?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsString()
  @IsNotEmpty()
  customerCode!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  businessPlatform?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
