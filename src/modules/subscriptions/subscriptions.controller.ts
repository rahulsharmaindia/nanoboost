// ── Subscriptions controller ─────────────────────────────────
// HTTP route handlers for /v1/subscriptions and related endpoints.

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { UpgradeDto } from './dto/upgrade.dto';
import { DowngradeDto } from './dto/downgrade.dto';

@Controller('v1/subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
  ) {}

  /**
   * GET /v1/subscriptions/me
   *
   * Returns the authenticated creator's active subscription and a usage
   * snapshot for the current billing period. The snapshot lists every
   * capped feature with its current counter value so the client can render
   * `current_usage / cap` rows without a separate round-trip.
   *
   * Response shape:
   * ```json
   * {
   *   "subscription": { …Subscription row… },
   *   "usage": [
   *     { "feature": "application_outbound", "current": 3, "periodStart": "…", "periodEnd": "…" },
   *     { "feature": "inbound_proposal",     "current": 1, "periodStart": "…", "periodEnd": "…" },
   *     { "feature": "ai_tool",              "current": 0, "periodStart": "…", "periodEnd": "…" }
   *   ]
   * }
   * ```
   *
   * Returns `{ subscription: null, usage: [] }` when no subscription record
   * exists for the user (should not happen in normal operation after signup).
   *
   * Requirements: 3.6, 16.7
   */
  @Get('me')
  @UseGuards(AuthGuard)
  async getMySubscription(@Req() req: Request): Promise<any> {
    const userId = (req as any).user?.userId as string;

    // 1. Fetch the active subscription row
    const subscription = await this.subscriptionsRepository.getActiveSubscription(userId);

    if (!subscription) {
      return { subscription: null, usage: [] };
    }

    // 2. Fetch usage counters for the current billing period
    const usage = await this.subscriptionsRepository.getUsageSnapshot(
      userId,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );

    return { subscription, usage };
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
