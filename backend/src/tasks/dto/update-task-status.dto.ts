import { IsOptional, IsString } from 'class-validator';

export class UpdateTaskStatusDto {
  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  blockedReason?: string;
}
