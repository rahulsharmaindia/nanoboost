import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AccountController } from './account.controller';
import { AuthService } from './auth.service';
import { AccountDeletionService } from './account-deletion.service';
import { MetaModule } from '../meta/meta.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [MetaModule, SubscriptionsModule],
  controllers: [AuthController, AccountController],
  providers: [AuthService, AccountDeletionService],
  exports: [AuthService, AccountDeletionService],
})
export class AuthModule {}
