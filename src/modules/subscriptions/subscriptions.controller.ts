// ── Subscriptions controller ─────────────────────────────────
// HTTP route handlers for /v1/subscriptions and related endpoints.

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { PlansCatalogService } from './plans-catalog.service';
import { CapEnforcerService } from './cap-enforcer.service';
import { capForFeature, type Feature, type Tier } from './subscriptions.types';
import { UpgradeDto } from './dto/upgrade.dto';
import { DowngradeDto } from './dto/downgrade.dto';

@Controller('v1/subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly plansCatalog: PlansCatalogService,
    private readonly capEnforcer: CapEnforcerService,
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
}
