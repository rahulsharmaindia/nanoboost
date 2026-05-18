import { IsIn } from 'class-validator';

export class DowngradeDto {
  @IsIn(['creator', 'growth'])
  targetTier: 'creator' | 'growth';
}
