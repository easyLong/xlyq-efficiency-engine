import { IsOptional, IsString, IsUUID } from 'class-validator';

export class SendWorklogRemindersDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  workDate?: string;
}
