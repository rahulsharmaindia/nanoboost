// ── Billing ──────────────────────────────────────────────────
// One subscription per influencer (UNIQUE). Add-ons owned by the
// influencer with optional subscription coupling. Payments form a
// financial ledger with idempotency; subscription_events is an
// append-only audit log.

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { influencers } from './influencers.schema';
import {
  tierEnum,
  localeEnum,
  currencyEnum,
  subscriptionStatusEnum,
  addonIdEnum,
  addonLifecycleEnum,
  addonStatusEnum,
  paymentStatusEnum,
  paymentPurposeEnum,
  payoutStatusEnum,
  subscriptionEventTypeEnum,
  partyTypeEnum,
} from './enums.schema';

export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tier: tierEnum('tier').notNull(),
    locale: localeEnum('locale').notNull(),
    priceMinorUnits: integer('price_minor_units').notNull(),
    currency: currencyEnum('currency').notNull(),
    isMostPopular: boolean('is_most_popular').notNull().default(false),
    analyticsWindowDays: integer('analytics_window_days').notNull(),
    applicationCapMonthly: integer('application_cap_monthly').notNull(),
    proposalCapMonthly: integer('proposal_cap_monthly').notNull(),
    aiToolCapMonthly: integer('ai_tool_cap_monthly').notNull(),
    commissionPct: integer('commission_pct').notNull(),
    concurrentCampaignsCap: integer('concurrent_campaigns_cap').notNull(),
    supportLevel: text('support_level').notNull(),
    earlyAccessHours: integer('early_access_hours').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tierLocaleUnique: uniqueIndex('uq_plan_tier_locale').on(t.tier, t.locale),
  }),
);

export const subscriptions = pgTable('subscriptions', {
  subscriptionId: text('subscription_id').primaryKey().$defaultFn(() => randomUUID()),
  influencerId: text('influencer_id')
    .notNull()
    .unique()
    .references(() => influencers.influencerId, { onDelete: 'cascade' }),
  tier: tierEnum('tier').notNull(),
  status: subscriptionStatusEnum('status').notNull().default('active'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  pendingTier: tierEnum('pending_tier'),
  paymentOwed: boolean('payment_owed').notNull().default(false),
  locale: localeEnum('locale').notNull(),
  processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const addOnPurchases = pgTable(
  'add_on_purchases',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    subscriptionId: text('subscription_id').references(() => subscriptions.subscriptionId, {
      onDelete: 'set null',
    }),
    addonId: addonIdEnum('addon_id').notNull(),
    lifecycle: addonLifecycleEnum('lifecycle').notNull(),
    status: addonStatusEnum('status').notNull().default('active'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    effectiveStart: timestamp('effective_start', { withTimezone: true }),
    effectiveEnd: timestamp('effective_end', { withTimezone: true }),
    remainingCredits: integer('remaining_credits'),
    consumptionCounters: jsonb('consumption_counters'),
    locale: localeEnum('locale').notNull(),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    influencerIdx: index('idx_addon_influencer').on(t.influencerId, t.status),
  }),
);

export const usageCounters = pgTable(
  'usage_counters',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    value: integer('value').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueCounter: uniqueIndex('uq_counter_influencer_feature_period').on(
      t.influencerId,
      t.feature,
      t.periodStart,
    ),
  }),
);

export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    purpose: paymentPurposeEnum('purpose').notNull(),
    subscriptionId: text('subscription_id').references(() => subscriptions.subscriptionId, {
      onDelete: 'set null',
    }),
    addOnPurchaseId: text('add_on_purchase_id').references(() => addOnPurchases.id, {
      onDelete: 'set null',
    }),
    amountMinorUnits: integer('amount_minor_units').notNull(),
    currency: currencyEnum('currency').notNull(),
    providerRef: text('provider_ref'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    chargedAt: timestamp('charged_at', { withTimezone: true }),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    influencerIdx: index('idx_payments_influencer').on(t.influencerId, t.createdAt),
  }),
);

export const influencerPayouts = pgTable(
  'influencer_payouts',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    dealRef: text('deal_ref').notNull(),
    grossAmountMinor: integer('gross_amount_minor').notNull(),
    commissionMinor: integer('commission_minor').notNull(),
    creatorShareMinor: integer('creator_share_minor').notNull(),
    commissionPct: integer('commission_pct').notNull(),
    tierAtPayout: tierEnum('tier_at_payout').notNull(),
    currency: currencyEnum('currency').notNull(),
    status: payoutStatusEnum('status').notNull().default('pending'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    influencerIdx: index('idx_payouts_influencer').on(t.influencerId, t.createdAt),
  }),
);

export const subscriptionEvents = pgTable(
  'subscription_events',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    subscriptionId: text('subscription_id').references(() => subscriptions.subscriptionId, {
      onDelete: 'set null',
    }),
    eventType: subscriptionEventTypeEnum('event_type').notNull(),
    actorType: partyTypeEnum('actor_type').notNull(),
    actorId: text('actor_id'),
    beforeSnapshot: jsonb('before_snapshot'),
    afterSnapshot: jsonb('after_snapshot'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    influencerIdx: index('idx_sub_events_influencer').on(t.influencerId, t.createdAt),
  }),
);

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type AddOnPurchase = typeof addOnPurchases.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type InfluencerPayout = typeof influencerPayouts.$inferSelect;
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
