import { IsIn } from 'class-validator';

export class UpgradeDto {
  @IsIn(['growth', 'studio'])
  targetTier: 'growth' | 'studio';
}
