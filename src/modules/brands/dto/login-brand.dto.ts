import { IsString, IsNotEmpty } from 'class-validator';

export class LoginBrandDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
