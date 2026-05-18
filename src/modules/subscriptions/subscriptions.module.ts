// ── Subscriptions module ─────────────────────────────────────
// NestJS feature module for creator subscriptions, plans, cap
// enforcement, add-ons, and billing. Mirrors the campaigns module
// wiring pattern.
//
// Not registered in AppModule yet — that happens in task 12.1.

import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { PlansController } from './plans.controller';
import { InternalCapController } from './internal-cap.controller';
import { AddOnsController } from './add-ons.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionEventsRepository } from './subscription-events.repository';
import { MoneyMathService } from './money-math.service';
import { PlansCatalogService } from './plans-catalog.service';
import { CapEnforcerService } from './cap-enforcer.service';
import { SubscriptionsFacade } from './subscriptions.facade';
import { PromotionService } from './promotion.service';
import { AddOnsService } from './add-ons.service';
import { PaymentPort } from './ports/payment.port';
import { MockPaymentAdapter } from './adapters/mock-payment.adapter';
import { RazorpayPaymentAdapter } from './adapters/razorpay-payment.adapter';
import { NotificationsModule } from '../notifications/notifications.module';
import { PeriodAdvanceScheduler } from './schedulers/period-advance.scheduler';
import { AddonRenewalScheduler } from './schedulers/addon-renewal.scheduler';
import { HeldProposalSweeper } from './schedulers/held-proposal.sweeper';
import { BoostExpirationSweeper } from './schedulers/boost-expiration.sweeper';

/**
 * Resolve the concrete PaymentPort adapter from the PAYMENT_ADAPTER env var.
 *
 * Supported values:
 *   'razorpay'  → RazorpayPaymentAdapter  (real Razorpay test/live keys)
 *   'mock'      → MockPaymentAdapter      (default for tests / local dev)
 *   'stripe'    → StripePaymentAdapter    (not yet implemented)
 *
 * Swapping providers requires only a new adapter class — no changes to
 * SubscriptionsService or AddOnsService. Razorpay flows route through the
 * `/upgrade/order|verify` and `/add-ons/me/purchase/order|verify` endpoints
 * exposed by the controllers.
 */
function resolvePaymentAdapter() {
  const adapter = process.env.PAYMENT_ADAPTER;
  if (adapter === 'razorpay') {
    return RazorpayPaymentAdapter;
  }
  if (adapter === 'mock' || !adapter) {
    return MockPaymentAdapter;
  }
  // Default to mock for unrecognised values during development.
  return MockPaymentAdapter;
}

@Module({
  imports: [NotificationsModule],
  controllers: [SubscriptionsController, PlansController, InternalCapController, AddOnsController, PaymentsWebhookController],
  providers: [
    SubscriptionsService,
    SubscriptionsRepository,
    SubscriptionEventsRepository,
    MoneyMathService,
    PlansCatalogService,
    CapEnforcerService,
    SubscriptionsFacade,
    PromotionService,
    AddOnsService,
    PeriodAdvanceScheduler,
    AddonRenewalScheduler,
    HeldProposalSweeper,
    BoostExpirationSweeper,
    {
      provide: PaymentPort,
      useClass: resolvePaymentAdapter(),
    },
  ],
  exports: [SubscriptionsService, SubscriptionsRepository, SubscriptionEventsRepository, MoneyMathService, PlansCatalogService, CapEnforcerService, SubscriptionsFacade, PromotionService, AddOnsService, PaymentPort],
})
export class SubscriptionsModule {}
