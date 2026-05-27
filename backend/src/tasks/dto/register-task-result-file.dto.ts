import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class RegisterTaskResultFileDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsOptional()
  @IsString()
  feishuFileToken?: string;

  @IsOptional()
  @IsUUID()
  uploadedByUserId?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
