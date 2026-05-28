import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

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
  @IsString()
  objectType?: string;

  @IsOptional()
  @IsUUID()
  objectId?: string;
}
