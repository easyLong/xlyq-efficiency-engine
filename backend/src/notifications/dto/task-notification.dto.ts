import { IsOptional, IsString, IsUUID } from 'class-validator';

export class TaskNotificationDto {
  @IsUUID()
  taskId!: string;

  @IsOptional()
  @IsString()
  message?: string;
}
