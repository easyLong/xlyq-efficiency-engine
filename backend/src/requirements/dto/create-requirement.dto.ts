import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateRequirementDto {
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
}
