import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateWechatGroupConfigDto {
  @IsOptional()
  @IsString()
  groupId?: string;

  @IsString()
  @IsNotEmpty()
  groupName!: string;

  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsUUID()
  contactContextConfigId?: string;

  @IsOptional()
  @IsString()
  businessPlatform?: string;

  @IsOptional()
  @IsBoolean()
  collectEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}
