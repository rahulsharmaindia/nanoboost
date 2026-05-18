// ── SubscriptionsFacade ───────────────────────────────────────
// Read-only API surface exported by SubscriptionsModule for
// consumption by other modules (CampaignsModule, ProposalsModule,
// AiToolsModule, etc.).
//
// Other modules MUST NOT read subscription tables directly — they
// go through this facade so cap-enforcement evolution stays local
// to SubscriptionsModule.
//
// Requirements: design §Module boundary rules

import { Injectable } from '@nestjs/common';
import { CapEnforcerService } from './cap-enforcer.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { PromotionService } from './promotion.service';
import { capForFeature } from './subscriptions.types';
import type { CheckResult, Feature } from './subscriptions.types';
import type { Plan } from '../../database/schema/plans.schema';

@Injectable()
export class SubscriptionsFacade {
  constructor(
    private readonly capEnforcer: CapEnforcerService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly promotionService: PromotionService,
  ) {}

  /**
   * Get the active subscription row for a user.
   * Returns null when no subscription exists (e.g. pre-signup).
   */
  async getActive(userId: string) {
    return this.subscriptionsRepository.getActiveSubscription(userId);
  }

  /**
   * Atomically check and consume a usage cap for the given feature.
   * Delegates to CapEnforcerService which owns the atomic increment logic.
   */
  async tryConsume(userId: string, feature: Feature): Promise<CheckResult> {
    return this.capEnforcer.tryConsume(userId, feature);
  }

  /**
   * Check whether the creator can activate another concurrent campaign.
   * Returns a result object — callers should inspect `allowed` before proceeding.
   */
  async checkConcurrent(userId: string): Promise<{
    allowed: boolean;
    current: number;
    cap: number;
    suggestedTier?: string;
  }> {
    return this.capEnforcer.checkConcurrent(userId);
  }

  /**
   * Check if a user has an active boost add-on.
   * Delegates to PromotionService which queries add_on_purchases.
   *
   * Requirements: 13.2, 19.1, 19.2
   */
  async isBoostActive(userId: string): Promise<boolean> {
    return this.promotionService.isBoostActive(userId);
  }

  /**
   * Get the cap value for a feature given a plan row.
   * Thin wrapper around the pure `capForFeature` helper so callers
   * don't need to import from subscriptions.types directly.
   */
  capFor(plan: Plan, feature: Feature): number {
    return capForFeature(plan, feature);
  }
}
