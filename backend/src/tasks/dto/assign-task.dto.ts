import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AssignTaskDto {
  @IsString()
  @IsNotEmpty()
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
