import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class SendBotMessageDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  objectType?: string;

  @IsOptional()
  @IsUUID()
  objectId?: string;

  @IsOptional()
  @IsString()
  feishuObjectType?: string;

  @IsOptional()
  @IsString()
  feishuObjectId?: string;
}
