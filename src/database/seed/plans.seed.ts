/**
 * Idempotent seed script for the `plans` table.
 *
 * Upserts all 6 plan rows (3 tiers × 2 locales) using the canonical
 * values from the design document §Migrations. Safe to re-run at any
 * time — conflicts on the (tier, locale) unique index trigger a full
 * update of every mutable column.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/database/seed/plans.seed.ts
 *
 * Or call seedPlans() programmatically from a migration runner.
 */

import { sql } from 'drizzle-orm';
import { getDrizzleClient } from '../database.client';
import { plans } from '../schema/plans.schema';

const PLAN_ROWS: (typeof plans.$inferInsert)[] = [
  // ── India (INR) ──────────────────────────────────────────────────────────
  {
    tier: 'creator',
    locale: 'IN',
    priceMinorUnits: 0,
    currency: 'INR',
    isMostPopular: false,
    analyticsWindowDays: 7,
    applicationCapMonthly: 0,
    proposalCapMonthly: 0,
    aiToolCapMonthly: 0,
    commissionPct: 15,
    concurrentCampaignsCap: 0,
    supportLevel: 'community',
    earlyAccessHours: 0,
  },
  {
    tier: 'growth',
    locale: 'IN',
    priceMinorUnits: 49900,
    currency: 'INR',
    isMostPopular: true,
    analyticsWindowDays: 30,
    applicationCapMonthly: 10,
    proposalCapMonthly: 3,
    aiToolCapMonthly: 25,
    commissionPct: 10,
    concurrentCampaignsCap: 3,
    supportLevel: 'email',
    earlyAccessHours: 0,
  },
  {
    tier: 'studio',
    locale: 'IN',
    priceMinorUnits: 149900,
    currency: 'INR',
    isMostPopular: false,
    analyticsWindowDays: 90,
    applicationCapMonthly: -1,
    proposalCapMonthly: -1,
    aiToolCapMonthly: -1,
    commissionPct: 5,
    concurrentCampaignsCap: -1,
    supportLevel: 'priority_email',
    earlyAccessHours: 24,
  },

  // ── United States (USD) ──────────────────────────────────────────────────
  {
    tier: 'creator',
    locale: 'US',
    priceMinorUnits: 0,
    currency: 'USD',
    isMostPopular: false,
    analyticsWindowDays: 7,
    applicationCapMonthly: 0,
    proposalCapMonthly: 0,
    aiToolCapMonthly: 0,
    commissionPct: 15,
    concurrentCampaignsCap: 0,
    supportLevel: 'community',
    earlyAccessHours: 0,
  },
  {
    tier: 'growth',
    locale: 'US',
    priceMinorUnits: 599,
    currency: 'USD',
    isMostPopular: true,
    analyticsWindowDays: 30,
    applicationCapMonthly: 10,
    proposalCapMonthly: 3,
    aiToolCapMonthly: 25,
    commissionPct: 10,
    concurrentCampaignsCap: 3,
    supportLevel: 'email',
    earlyAccessHours: 0,
  },
  {
    tier: 'studio',
    locale: 'US',
    priceMinorUnits: 1899,
    currency: 'USD',
    isMostPopular: false,
    analyticsWindowDays: 90,
    applicationCapMonthly: -1,
    proposalCapMonthly: -1,
    aiToolCapMonthly: -1,
    commissionPct: 5,
    concurrentCampaignsCap: -1,
    supportLevel: 'priority_email',
    earlyAccessHours: 24,
  },
];

export async function seedPlans(): Promise<void> {
  const db = getDrizzleClient();
  if (!db) {
    throw new Error('Database client unavailable — ensure DATABASE_URL is set.');
  }

  await db
    .insert(plans)
    .values(PLAN_ROWS)
    .onConflictDoUpdate({
      // Target the (tier, locale) unique constraint defined in plans.schema.ts
      target: [plans.tier, plans.locale],
      set: {
        priceMinorUnits: sql`excluded.price_minor_units`,
        currency: sql`excluded.currency`,
        isMostPopular: sql`excluded.is_most_popular`,
        analyticsWindowDays: sql`excluded.analytics_window_days`,
        applicationCapMonthly: sql`excluded.application_cap_monthly`,
        proposalCapMonthly: sql`excluded.proposal_cap_monthly`,
        aiToolCapMonthly: sql`excluded.ai_tool_cap_monthly`,
        commissionPct: sql`excluded.commission_pct`,
        concurrentCampaignsCap: sql`excluded.concurrent_campaigns_cap`,
        supportLevel: sql`excluded.support_level`,
        earlyAccessHours: sql`excluded.early_access_hours`,
        updatedAt: sql`now()`,
      },
    });

  console.log(`✅  plans seed: upserted ${PLAN_ROWS.length} rows`);
}

// ── Standalone entry-point ────────────────────────────────────────────────
// Runs when executed directly: ts-node src/database/seed/plans.seed.ts
if (require.main === module) {
  seedPlans()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌  plans seed failed:', err);
      process.exit(1);
    });
}
