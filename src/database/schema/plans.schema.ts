import { pgTable, text, integer, boolean, timestamp, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const tierEnum = pgEnum('tier', ['creator', 'growth', 'studio']);
export const localeEnum = pgEnum('locale', ['IN', 'US']);
export const currencyEnum = pgEnum('currency', ['INR', 'USD']);

export const plans = pgTable('plans', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  tier: tierEnum('tier').notNull(),
  locale: localeEnum('locale').notNull(),
  priceMinorUnits: integer('price_minor_units').notNull(),     // paise / cents
  currency: currencyEnum('currency').notNull(),
  isMostPopular: boolean('is_most_popular').notNull().default(false),

  // Feature limits (-1 = unlimited)
  analyticsWindowDays: integer('analytics_window_days').notNull(),
  applicationCapMonthly: integer('application_cap_monthly').notNull(),
  proposalCapMonthly: integer('proposal_cap_monthly').notNull(),
  aiToolCapMonthly: integer('ai_tool_cap_monthly').notNull(),
  commissionPct: integer('commission_pct').notNull(),          // 0..100
  concurrentCampaignsCap: integer('concurrent_campaigns_cap').notNull(),
  supportLevel: text('support_level').notNull(),               // 'community'|'email'|'priority_email'
  earlyAccessHours: integer('early_access_hours').notNull().default(0),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqTierLocale: uniqueIndex('plans_tier_locale_uniq').on(t.tier, t.locale),
}));

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
