import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateRequirementWithTaskDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  customerId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  rawContent?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  estimatedHours?: string;

  @IsOptional()
  @IsUUID()
  contactContextId?: string;

  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  businessPlatform?: string;

  @IsOptional()
  @IsString()
  tertiaryCategory?: string;
}
