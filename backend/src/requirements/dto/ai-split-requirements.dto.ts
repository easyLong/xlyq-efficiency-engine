import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class AiSplitRequirementsDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  customerId!: string;

  @IsString()
  @IsNotEmpty()
  rawContent!: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  estimatedHours?: string;
}
