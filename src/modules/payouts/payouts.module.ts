/**
 * PayoutsModule — deal payout computation.
 *
 * Imports SubscriptionsModule to access MoneyMathService and
 * SubscriptionsFacade. Never mutates subscription state.
 *
 * Requirements: 9.1–9.5, design §Module boundary rules
 */

import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
