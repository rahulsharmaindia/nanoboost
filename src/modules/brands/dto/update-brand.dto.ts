import { IsOptional, IsString } from 'class-validator';

/// Partial-update DTO for an authenticated brand's own profile.
/// businessId and password are intentionally NOT updatable here —
/// changing the handle would break campaign references and password
/// changes need a separate flow with re-authentication.
export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  socialLinks?: Record<string, string | null>;
}
