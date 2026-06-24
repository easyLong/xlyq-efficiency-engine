import { IsNotEmpty, IsString } from 'class-validator';

export class PasswordLoginDto {
  @IsString()
  @IsNotEmpty()
  account!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
