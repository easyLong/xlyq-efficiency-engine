import { IsOptional, IsString } from 'class-validator';

export class ProvisionTaskWorkspaceDto {
  @IsOptional()
  @IsString()
  assigneeUserId?: string;

  @IsOptional()
  @IsString()
  feishuFolderToken?: string;

  @IsOptional()
  @IsString()
  directoryUrl?: string;
}
