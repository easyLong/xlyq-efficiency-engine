import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FeishuMessageActionDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsObject()
  value?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  type?: string;
}

export class SendAppMessageDto {
  @IsIn(['open_id', 'user_id', 'union_id', 'email', 'chat_id'])
  receiveIdType!: string;

  @IsString()
  @IsNotEmpty()
  receiveId!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  actionUrl?: string;

  @IsOptional()
  @IsString()
  actionText?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeishuMessageActionDto)
  actions?: FeishuMessageActionDto[];

  @IsOptional()
  @IsString()
  objectType?: string;

  @IsOptional()
  @IsUUID()
  objectId?: string;
}
