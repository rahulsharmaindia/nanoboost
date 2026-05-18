import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignsRepository } from './campaigns.repository';
import { MetaModule } from '../meta/meta.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [MetaModule, SubscriptionsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignsRepository],
  exports: [CampaignsService, CampaignsRepository],
})
export class CampaignsModule {}
