import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ParseQuotationTextDto {
  @IsString()
  @IsNotEmpty()
  rawContent!: string;

  @IsOptional()
  @IsString()
  fileName?: string;
}
