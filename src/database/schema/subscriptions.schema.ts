import { pgTable, text, timestamp, pgEnum, boolean, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { tierEnum, localeEnum } from './plans.schema';

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active', 'canceling', 'canceled', 'payment_failed', 'lapsed',
]);

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull(),
  tier: tierEnum('tier').notNull(),
  status: subscriptionStatusEnum('status').notNull().default('active'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  pendingTier: tierEnum('pending_tier'),
  paymentOwed: boolean('payment_owed').notNull().default(false),
  locale: localeEnum('locale').notNull(),
  /**
   * Scheduler lease column — set to now() when the scheduler picks up this
   * row for processing. Cleared (set to NULL) after processing completes.
   * Prevents two scheduler instances from processing the same subscription
   * concurrently. A stale lease (> 5 minutes old) is treated as expired.
   * Requirements: 4.2, 23.1
   */
  processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqUserActive: uniqueIndex('subscriptions_user_uniq').on(t.userId),
  periodValid: check('period_valid', sql`${t.currentPeriodEnd} > ${t.currentPeriodStart}`),
}));

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
