// ── CapEnforcerService ────────────────────────────────────────
// Atomic cap check and increment for usage-gated features.
//
// The core operation is a single SQL statement:
//   INSERT INTO usage_counters … ON CONFLICT DO UPDATE … WHERE value < cap
//
// Postgres guarantees this is atomic at the row level — two concurrent
// requests at value = cap − 1 cannot both succeed. The second sees
// value = cap, the WHERE clause filters it out, and RETURNING yields
// zero rows, which we map to CAP_EXCEEDED.
//
// Feature flag (design §Migration & Rollout):
//   When `creatorPackagesEnabled` is false, all cap checks are bypassed
//   and `{ allowed: true, newValue: -1, cap: -1 }` is returned immediately.
//   This preserves the old behaviour (no paywalls, all features open)
//   during the controlled rollout.
//
// Requirements: 3.1, 3.2, 3.3, 3.5, 3.7, 3.8

import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, lt, sql } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { subscriptions } from '../../database/schema/subscriptions.schema';
import { usageCounters } from '../../database/schema/usage_counters.schema';
import { plans } from '../../database/schema/plans.schema';
import { campaignCollaborations } from '../../database/schema/campaign_collaborations.schema';
import {
  CheckResult,
  Feature,
  Tier,
  capForFeature,
  nextTier,
} from './subscriptions.types';
import { SubscriptionNotFoundError } from './subscriptions.errors';
import { FeatureFlagsService } from '../../common/config/feature-flags.service';

@Injectable()
export class CapEnforcerService {
  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  /**
   * Atomically checks and increments the usage counter for `feature`.
   *
   * Returns a `CheckResult`:
   *  - `{ allowed: true, newValue, cap }` — counter incremented, action permitted.
   *  - `{ allowed: false, reason: 'TIER_LOCKED', … }` — feature not available on this tier (cap === 0).
   *  - `{ allowed: false, reason: 'CAP_EXCEEDED', … }` — monthly cap already reached.
   *
   * Requirement 3.1: server is the authoritative cap enforcer.
   * Requirement 3.2: CAP_EXCEEDED returned when counter >= cap.
   * Requirement 3.3: TIER_LOCKED returned when cap === 0.
   * Requirement 3.5: unlimited features (cap === -1) always allowed.
   * Requirement 3.7: atomic increment — no double-spend under concurrency.
   * Requirement 3.8: counter scoped to the active billing period.
   */
  async tryConsume(userId: string, feature: Feature): Promise<CheckResult> {
    // ── Feature flag bypass ──────────────────────────────────────────
    // Design §Migration & Rollout: when creator_packages_enabled is off
    // (globally, or for this specific user during a percentage rollout),
    // skip all cap enforcement and allow every action unconditionally.
    if (!this.featureFlags.isCreatorPackagesEnabledForUser(userId)) {
      return { allowed: true, newValue: -1, cap: -1 };
    }

    return this.db.transaction(async (tx: any) => {
      // ── 1. Resolve active subscription ──────────────────────────────
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

      if (!sub) {
        throw new SubscriptionNotFoundError(userId);
      }

      // ── 2. Resolve plan for this tier + locale ───────────────────────
      const plan = await this.planFor(tx, sub.tier as Tier, sub.locale);

      // ── 3. Determine cap for the requested feature ───────────────────
      const cap = capForFeature(plan, feature);

      // ── 4. cap === 0 → feature locked on this tier ───────────────────
      // Requirement 3.3
      if (cap === 0) {
        return {
          allowed: false,
          reason: 'TIER_LOCKED' as const,
          current: 0,
          cap: 0,
          suggestedTier: nextTier(sub.tier as Tier),
        };
      }

      // ── 5. cap === -1 → unlimited, always allowed ────────────────────
      // Requirement 3.5
      if (cap === -1) {
        return { allowed: true, newValue: -1, cap: -1 };
      }

      // ── 6. Atomic conditional increment ─────────────────────────────
      // INSERT a new row with value=1, or UPDATE the existing row by +1
      // only when value < cap. The WHERE clause on the conflict target
      // makes this a no-op (returns 0 rows) when the cap is already met.
      // Requirement 3.7, 3.8
      const updated = await tx
        .insert(usageCounters)
        .values({
          userId,
          feature,
          periodStart: sub.currentPeriodStart,
          periodEnd: sub.currentPeriodEnd,
          value: 1,
        })
        .onConflictDoUpdate({
          target: [
            usageCounters.userId,
            usageCounters.feature,
            usageCounters.periodStart,
          ],
          set: {
            value: sql`${usageCounters.value} + 1`,
            updatedAt: new Date(),
          },
          // Only increment when the current value is strictly below the cap.
          // This WHERE clause is the atomic guard against over-counting.
          where: lt(usageCounters.value, cap),
        })
        .returning({ value: usageCounters.value });

      // ── 7. No rows returned → cap was already met ────────────────────
      // Requirement 3.2
      if (updated.length === 0) {
        // Fetch the current counter value for the response payload.
        const existing = await tx.query.usageCounters.findFirst({
          where: eq(usageCounters.userId, userId),
        });
        const current = existing?.value ?? cap;

        return {
          allowed: false,
          reason: 'CAP_EXCEEDED' as const,
          current,
          cap,
          suggestedTier: nextTier(sub.tier as Tier),
        };
      }

      // ── 8. Increment succeeded ───────────────────────────────────────
      // Requirement 3.1
      return { allowed: true, newValue: updated[0].value, cap };
    });
  }

  /**
   * Checks whether the creator can activate another concurrent active campaign.
   *
   * Unlike usage counters, this is a live state count — not a monthly
   * rolling counter. It queries `campaign_collaborations` directly.
   *
   * Returns `{ allowed: true, current, cap }` when under the cap, or
   * `{ allowed: false, current, cap, suggestedTier }` when the cap is met
   * or the tier does not permit concurrent campaigns.
   *
   * Requirements: 2.6, 3.4, 3.5
   */
  async checkConcurrent(userId: string): Promise<{
    allowed: boolean;
    current: number;
    cap: number;
    suggestedTier?: Tier;
  }> {
    // ── Feature flag bypass ──────────────────────────────────────────
    // Design §Migration & Rollout: when creator_packages_enabled is off
    // (globally, or for this specific user during a percentage rollout),
    // skip concurrent-cap enforcement and allow every action unconditionally.
    if (!this.featureFlags.isCreatorPackagesEnabledForUser(userId)) {
      return { allowed: true, current: 0, cap: -1 };
    }

    // ── 1. Resolve active subscription ──────────────────────────────
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    if (!sub) {
      throw new SubscriptionNotFoundError(userId);
    }

    // ── 2. Resolve plan for this tier + locale ───────────────────────
    const plan = await this.planFor(this.db, sub.tier as Tier, sub.locale);
    const cap: number = plan.concurrentCampaignsCap;

    // ── 3. cap === 0 → tier locked (creator tier has no concurrent campaigns)
    // Requirement 3.4
    if (cap === 0) {
      return {
        allowed: false,
        current: 0,
        cap: 0,
        suggestedTier: nextTier(sub.tier as Tier),
      };
    }

    // ── 4. Live count of active collaborations ───────────────────────
    // SELECT COUNT(*) FROM campaign_collaborations
    //  WHERE creator_user_id = userId AND status = 'active'
    const rows = await this.db
      .select({ value: count() })
      .from(campaignCollaborations)
      .where(
        and(
          eq(campaignCollaborations.creatorUserId, userId),
          eq(campaignCollaborations.status, 'active'),
        ),
      );

    const current = Number(rows[0]?.value ?? 0);

    // ── 5. cap === -1 → unlimited, always allowed ────────────────────
    // Requirement 3.5
    if (cap === -1) {
      return { allowed: true, current, cap: -1 };
    }

    // ── 6. current >= cap → concurrent limit reached ─────────────────
    // Requirement 3.4
    if (current >= cap) {
      return {
        allowed: false,
        current,
        cap,
        suggestedTier: nextTier(sub.tier as Tier),
      };
    }

    // ── 7. Below cap → allowed ───────────────────────────────────────
    return { allowed: true, current, cap };
  }

  // ── Private helpers ────────────────────────────────────────────────────
  /**
   * Fetches the plan row for the given tier and locale.
   * Throws if no matching plan exists (catalog misconfiguration).
   */
  private async planFor(tx: any, tier: Tier, locale: string) {
    const plan = await tx.query.plans.findFirst({
      where: (p: typeof plans.$inferSelect, { and, eq: eqFn }: any) =>
        and(eqFn(p.tier, tier), eqFn(p.locale, locale)),
    });

    if (!plan) {
      throw new Error(
        `Plan not found for tier="${tier}" locale="${locale}" — ensure the plans catalog is seeded`,
      );
    }

    return plan;
  }
}
