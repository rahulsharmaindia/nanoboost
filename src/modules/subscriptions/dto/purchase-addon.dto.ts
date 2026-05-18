import { IsIn } from 'class-validator';

export class PurchaseAddonDto {
  @IsIn(['boost', 'ai_growth_pack', 'content_studio_pack'])
  addonId: 'boost' | 'ai_growth_pack' | 'content_studio_pack';
}
