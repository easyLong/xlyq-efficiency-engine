import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class AssignTaskDto {
  @IsUUID()
  assigneeUserId!: string;

  @IsOptional()
  @IsBoolean()
  provisionWorkspace?: boolean;

  @IsOptional()
  @IsString()
  feishuFolderToken?: string;

  @IsOptional()
  @IsString()
  directoryUrl?: string;
}
