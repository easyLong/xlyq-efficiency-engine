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

  @IsString()
  @IsNotEmpty()
  businessCategory!: string;

  @IsOptional()
  @IsString()
  secondaryCategory?: string;

  @IsOptional()
  @IsString()
  tertiaryCategory?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
