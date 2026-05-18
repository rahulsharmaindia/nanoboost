// ── Subscriptions controller ─────────────────────────────────
// HTTP route handlers for /v1/subscriptions and related endpoints.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { PlansCatalogService } from './plans-catalog.service';
import { CapEnforcerService } from './cap-enforcer.service';
import { capForFeature, type Feature, type Tier } from './subscriptions.types';
import { UpgradeDto } from './dto/upgrade.dto';
import { DowngradeDto } from './dto/downgrade.dto';
import { PaymentPort } from './ports/payment.port';
import { RazorpayPaymentAdapter } from './adapters/razorpay-payment.adapter';

@Controller('v1/subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly plansCatalog: PlansCatalogService,
    private readonly capEnforcer: CapEnforcerService,
    private readonly paymentPort: PaymentPort,
  ) {}

  /**
   * GET /v1/subscriptions/me
   *
   * Returns the authenticated creator's active subscription and a usage
   * snapshot for the current billing period. The snapshot pairs every
   * capped feature's current counter value with the tier's cap so the
   * client can render `current / cap` rows in one round-trip.
   *
   * Response shape (matches the Flutter `Subscription` + `Usage` models):
   * ```json
   * {
   *   "subscription": { …Subscription row… },
   *   "usage": {
   *     "features": {
   *       "application_outbound": { "current": 3, "cap": 10 },
   *       "inbound_proposal":     { "current": 1, "cap": 3  },
   *       "ai_tool":              { "current": 0, "cap": 25 }
   *     },
   *     "concurrentCampaigns": { "current": 0, "cap": 3 }
   *   }
   * }
   * ```
   *
   * `cap` follows the catalog convention: `0` means tier-locked, `-1` means
   * unlimited, any positive integer is the monthly limit.
   *
   * If no subscription row exists for the user (rare — should be created at
   * signup), returns an empty usage snapshot so the client renders gracefully
   * instead of throwing.
   *
   * Requirements: 3.6, 16.7
   */
  @Get('me')
  @UseGuards(AuthGuard)
  async getMySubscription(@Req() req: Request): Promise<any> {
    const userId =
      ((req as any).providerUserId as string | undefined) ??
      ((req as any).user?.userId as string | undefined);

    const empty = {
      subscription: null,
      usage: { features: {}, concurrentCampaigns: null },
    };

    if (!userId) return empty;

    // 1. Fetch the active subscription row.
    const subscription =
      await this.subscriptionsRepository.getActiveSubscription(userId);

    if (!subscription) return empty;

    // 2. Resolve the plan for this tier+locale so we can pair caps with
    //    counters. Falls back to defaults inside PlansCatalogService.
    const { plan } = await this.plansCatalog.getPlan(
      subscription.tier as Tier,
      subscription.locale,
    );

    // 3. Fetch usage counters for the current billing period.
    const counters = await this.subscriptionsRepository.getUsageSnapshot(
      userId,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );

    // 4. Build the per-feature map { current, cap } the client expects.
    const features: Record<string, { current: number; cap: number }> = {};
    for (const row of counters) {
      features[row.feature] = {
        current: row.current,
        cap: capForFeature(plan, row.feature as Feature),
      };
    }

    // 5. Live concurrent-campaigns count (not a monthly counter).
    const concurrentResult = await this.capEnforcer.checkConcurrent(userId);
    const concurrentCampaigns = {
      current: concurrentResult.current,
      cap: concurrentResult.cap,
    };

    return {
      subscription,
      usage: { features, concurrentCampaigns },
    };
  }

  /**
   * POST /v1/subscriptions/me/upgrade/order
   *
   * Step 1 of the interactive Razorpay upgrade flow. Computes the charge
   * amount for the requested upgrade and returns a Razorpay order id +
   * the public key id, which the client uses to open Razorpay Checkout.
   *
   * Does NOT mutate the subscription. The actual upgrade only happens in
   * the matching `/upgrade/verify` call after the user has paid.
   *
   * Requires PAYMENT_ADAPTER=razorpay; falls back to a clear 400 otherwise
   * so it's obvious during local dev when the env isn't set up.
   *
   * Requirements: 6.1, 6.2, 6.3, 6.7, 22.5
   */
  @Post('me/upgrade/order')
  @UseGuards(AuthGuard)
  async createUpgradeOrder(
    @Req() req: Request,
    @Body() dto: UpgradeDto,
  ): Promise<any> {
    const userId = (req as any).providerUserId as string;
    const intent = await this.subscriptionsService.prepareUpgrade(
      userId,
      dto.targetTier,
    );
    const adapter = this.requireRazorpay();
    const order = await adapter.createOrder({
      userId,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      idempotencyKey: intent.idempotencyKey,
      description: intent.description,
    });
    return { ...order };
  }

  /**
   * POST /v1/subscriptions/me/upgrade/verify
   *
   * Step 2 of the interactive Razorpay upgrade flow. Verifies the payload
   * returned by Razorpay Checkout's `handler` callback (HMAC SHA256 of
   * `orderId|paymentId` keyed by RAZORPAY_KEY_SECRET), then runs the
   * transactional upgrade and returns the updated subscription.
   *
   * Body shape:
   * ```json
   * {
   *   "targetTier": "growth" | "studio",
   *   "razorpayOrderId":  "order_NXa83hG...",
   *   "razorpayPaymentId": "pay_NXa83hH...",
   *   "razorpaySignature": "<hex>"
   * }
   * ```
   *
   * On signature mismatch returns 400 VALIDATION_ERROR. On any business
   * validation failure (subscription missing, payment_owed, etc.) the
   * existing typed subscription errors propagate.
   *
   * Requirements: 6.1, 6.5
   */
  @Post('me/upgrade/verify')
  @UseGuards(AuthGuard)
  async verifyUpgrade(@Req() req: Request, @Body() body: any): Promise<any> {
    const userId = (req as any).providerUserId as string;
    const targetTier = body?.targetTier;
    const razorpayOrderId = body?.razorpayOrderId;
    const razorpayPaymentId = body?.razorpayPaymentId;
    const razorpaySignature = body?.razorpaySignature;

    if (
      (targetTier !== 'growth' && targetTier !== 'studio') ||
      typeof razorpayOrderId !== 'string' ||
      typeof razorpayPaymentId !== 'string' ||
      typeof razorpaySignature !== 'string'
    ) {
      throw new BadRequestException(
        'Required: targetTier (growth|studio), razorpayOrderId, razorpayPaymentId, razorpaySignature.',
      );
    }

    const adapter = this.requireRazorpay();
    const { providerRef } = adapter.verifyPayment({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    const subscription = await this.subscriptionsService.finalizeUpgrade(
      userId,
      targetTier,
      providerRef,
    );
    return { subscription };
  }

  /**
   * Upgrade the authenticated user's subscription to a higher tier.
   *
   * Charges the prorated (paid→paid) or full (free→paid) amount immediately,
   * updates the subscription row, and returns the updated subscription.
   *
   * Requirements: 6.1
   */
  @Post('me/upgrade')
  @UseGuards(AuthGuard)
  async upgrade(@Req() req: Request, @Body() dto: UpgradeDto): Promise<any> {
    const userId = (req as any).providerUserId as string;
    const subscription = await this.subscriptionsService.upgrade(userId, dto.targetTier);
    return { subscription };
  }

  /**
   * Schedule a downgrade for the authenticated user's subscription.
   *
   * Records the target tier as `pending_tier`; the actual tier change is
   * applied by the period-advance scheduler at `current_period_end`.
   * Returns the current (still-active) subscription row.
   *
   * Requirements: 7.1
   */
  @Post('me/downgrade')
  @UseGuards(AuthGuard)
  async downgrade(@Req() req: Request, @Body() dto: DowngradeDto): Promise<any> {
    const userId = (req as any).providerUserId as string;
    await this.subscriptionsService.scheduleDowngrade(userId, dto.targetTier);
    const subscription = await this.subscriptionsRepository.getActiveSubscription(userId);
    return { subscription };
  }

  /**
   * Cancel the authenticated user's subscription.
   *
   * Sets status to `canceling`; the subscription remains active until
   * `current_period_end`, at which point the scheduler reverts to creator tier.
   * Returns the updated subscription row.
   *
   * Requirements: 8.1, 8.3
   */
  @Post('me/cancel')
  @UseGuards(AuthGuard)
  async cancel(@Req() req: Request): Promise<any> {
    const userId = (req as any).providerUserId as string;
    await this.subscriptionsService.cancel(userId);
    const subscription = await this.subscriptionsRepository.getActiveSubscription(userId);
    return { subscription };
  }

  /**
   * Resume a canceling subscription for the authenticated user.
   *
   * Reverts status from `canceling` back to `active`, keeping the existing
   * period and tier intact. Returns the updated subscription row.
   *
   * Requirements: 8.1, 8.3
   */
  @Post('me/resume')
  @UseGuards(AuthGuard)
  async resume(@Req() req: Request): Promise<any> {
    const userId = (req as any).providerUserId as string;
    await this.subscriptionsService.resume(userId);
    const subscription = await this.subscriptionsRepository.getActiveSubscription(userId);
    return { subscription };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Narrows the injected PaymentPort to a RazorpayPaymentAdapter.
   * Throws a 400 with a clear message if the active adapter is not
   * Razorpay (e.g. PAYMENT_ADAPTER=mock during local dev), so we don't
   * silently render a broken Checkout flow.
   */
  private requireRazorpay(): RazorpayPaymentAdapter {
    if (!(this.paymentPort instanceof RazorpayPaymentAdapter)) {
      throw new BadRequestException(
        'razorpay_unavailable — set PAYMENT_ADAPTER=razorpay and provide ' +
          'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to use the upgrade flow.',
      );
    }
    return this.paymentPort;
  }
}
