import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AiMatchRequirementContextDto {
  @IsString()
  @IsNotEmpty()
  rawContent!: string;

  @IsOptional()
  @IsString()
  fileName?: string;
}
