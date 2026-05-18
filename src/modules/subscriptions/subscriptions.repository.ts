// ── Subscriptions repository ─────────────────────────────────
// Persistence layer for subscriptions, plans, usage counters,
// add-on purchases, subscription events, and payments.
// Uses Drizzle ORM against the Supabase Postgres database.
// DATABASE_URL must be set — there is no in-memory fallback.

import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { subscriptions } from '../../database/schema/subscriptions.schema';
import type { Subscription } from '../../database/schema/subscriptions.schema';
import { usageCounters, FEATURES } from '../../database/schema/usage_counters.schema';
import type { UsageCounter } from '../../database/schema/usage_counters.schema';

/** Per-feature usage entry returned in the snapshot. */
export interface UsageEntry {
  feature: string;
  current: number;
  periodStart: Date;
  periodEnd: Date;
}

@Injectable()
export class SubscriptionsRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {
    if (!db) {
      throw new Error(
        'DATABASE_URL is not configured. SubscriptionsRepository requires a database connection.',
      );
    }
  }

  /**
   * Returns the active subscription row for a user, or null if none exists.
   * Each user has at most one subscription row (enforced by unique index).
   */
  async getActiveSubscription(userId: string): Promise<Subscription | null> {
    const row = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });
    return row ?? null;
  }

  /**
   * Returns the current-period usage counters for a user.
   *
   * Fetches all counter rows whose `periodStart` matches the subscription's
   * `currentPeriodStart`. Features with no row yet (counter never incremented)
   * are returned with `current = 0` so the client always receives a complete
   * snapshot for all known features.
   *
   * Requirements: 3.6, 16.7
   */
  async getUsageSnapshot(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageEntry[]> {
    const rows: UsageCounter[] = await this.db.query.usageCounters.findMany({
      where: and(
        eq(usageCounters.userId, userId),
        eq(usageCounters.periodStart, periodStart),
      ),
    });

    // Build a map for quick lookup
    const byFeature = new Map<string, number>(
      rows.map((r) => [r.feature, r.value]),
    );

    // Return an entry for every known feature, defaulting to 0 if no row exists
    return FEATURES.map((feature) => ({
      feature,
      current: byFeature.get(feature) ?? 0,
      periodStart,
      periodEnd,
    }));
  }
}
