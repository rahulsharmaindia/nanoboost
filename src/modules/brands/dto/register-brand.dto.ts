import { IsString, IsNotEmpty, IsOptional, MinLength } from 'class-validator';

export class RegisterBrandDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  logo: string;

  @IsString()
  @IsNotEmpty()
  industry: string;

  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  socialLinks?: any;
}
