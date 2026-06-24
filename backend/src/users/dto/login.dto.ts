import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsOptional()
  @IsString()
  loginKey?: string;
}
