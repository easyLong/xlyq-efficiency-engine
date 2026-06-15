import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateContactContextConfigDto {
  @IsString()
  @IsNotEmpty()
  contactName!: string;

  @IsOptional()
  @IsString()
  contactMobile?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsString()
  businessPlatform?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
