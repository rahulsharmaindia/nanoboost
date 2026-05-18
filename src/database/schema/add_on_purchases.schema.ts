// server/src/database/schema/add_on_purchases.schema.ts
import { pgTable, text, integer, timestamp, jsonb, pgEnum, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { localeEnum } from './plans.schema';

export const addonIdEnum = pgEnum('addon_id', ['boost', 'ai_growth_pack', 'content_studio_pack']);
export const addonLifecycleEnum = pgEnum('addon_lifecycle', ['one_time', 'recurring']);
export const addonStatusEnum = pgEnum('addon_status', [
  'active', 'canceling', 'canceled', 'expired', 'payment_failed', 'lapsed',
]);

export const addOnPurchases = pgTable('add_on_purchases', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull(),
  addonId: addonIdEnum('addon_id').notNull(),
  lifecycle: addonLifecycleEnum('lifecycle').notNull(),
  status: addonStatusEnum('status').notNull().default('active'),

  // recurring
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),

  // one-time (duration-based for boost)
  effectiveStart: timestamp('effective_start', { withTimezone: true }),
  effectiveEnd: timestamp('effective_end', { withTimezone: true }),

  remainingCredits: integer('remaining_credits'),
  consumptionCounters: jsonb('consumption_counters'),     // { videoEditsUsed, scriptsUsed }
  locale: localeEnum('locale').notNull(),

  /**
   * Scheduler lease column — set to now() when the addon renewal scheduler
   * picks up this row for processing. Cleared after processing completes.
   * Prevents two scheduler instances from processing the same purchase
   * concurrently. A stale lease (> 5 minutes old) is treated as expired.
   * Requirements: 14.2, 14.3, 14.4
   */
  processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  recurringValid: check('recurring_period_valid',
    sql`${t.lifecycle} <> 'recurring' OR ${t.currentPeriodEnd} IS NOT NULL`),
  oneTimeValid: check('one_time_effective_valid',
    sql`${t.lifecycle} <> 'one_time' OR ${t.effectiveEnd} IS NOT NULL`),
}));

export type AddOnPurchase = typeof addOnPurchases.$inferSelect;
export type NewAddOnPurchase = typeof addOnPurchases.$inferInsert;
