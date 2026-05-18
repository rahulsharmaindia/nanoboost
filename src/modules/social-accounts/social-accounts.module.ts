import { Module } from '@nestjs/common';
import { SocialAccountsController } from './social-accounts.controller';
import { SocialAccountsService } from './social-accounts.service';
import { CreatorProfileService } from './creator-profile.service';
import { MetaModule } from '../meta/meta.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [MetaModule, DatabaseModule],
  controllers: [SocialAccountsController],
  providers: [SocialAccountsService, CreatorProfileService],
  exports: [SocialAccountsService, CreatorProfileService],
})
export class SocialAccountsModule {}
