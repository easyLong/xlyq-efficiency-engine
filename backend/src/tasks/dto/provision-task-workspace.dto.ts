import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ProvisionTaskWorkspaceDto {
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @IsOptional()
  @IsString()
  feishuFolderToken?: string;

  @IsOptional()
  @IsString()
  directoryUrl?: string;
}
