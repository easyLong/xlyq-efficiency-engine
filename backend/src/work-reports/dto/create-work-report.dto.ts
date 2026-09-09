import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateWorkReportDto {
  @IsString()
  @IsIn(['customer_operation', 'internal_management'])
  businessCategory!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  secondaryCategory!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content!: string;
}
