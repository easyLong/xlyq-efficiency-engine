import { IsOptional, IsString } from 'class-validator';

export class SyncFeishuUsersDto {
  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
