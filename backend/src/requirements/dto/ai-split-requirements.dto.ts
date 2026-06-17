import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class AiSplitRequirementsDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  customerCode!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

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
