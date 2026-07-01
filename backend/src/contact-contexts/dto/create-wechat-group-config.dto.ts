import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateWechatGroupConfigDto {
  @IsOptional()
  @IsString()
  groupId?: string;

  @IsString()
  @IsNotEmpty()
  groupName!: string;

  @IsString()
  @IsNotEmpty()
  customerCode!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  groupNickname?: string;

  @IsOptional()
  @IsString()
  contactContextConfigId?: string;

  @IsOptional()
  @IsString()
  businessPlatform?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBoolean()
  collectEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  nicknameUpdated?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}
