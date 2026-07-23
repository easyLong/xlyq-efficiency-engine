import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class WorkflowHandoffDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  token!: string;
}
