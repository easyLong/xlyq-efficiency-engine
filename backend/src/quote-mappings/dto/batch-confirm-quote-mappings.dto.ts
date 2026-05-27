import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class BatchConfirmQuoteMappingsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  mappingIds!: string[];
}
