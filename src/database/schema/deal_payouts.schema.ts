/**
 * Deal payouts schema.
 *
 * Records every deal payout disbursement from a brand-funded escrow to a
 * creator. Stores the gross amount, the commission applied (at the creator's
 * tier at payout time), and the resulting creator share.
 *
 * This table is owned by PayoutsModule and is never mutated by
 * SubscriptionsModule.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { pgTable, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { currencyEnum, tierEnum } from './plans.schema';

export const dealPayoutStatusEnum = pgEnum('deal_payout_status', [
  'pending',
  'processed',
  'failed',
]);

export const dealPayouts = pgTable('deal_payouts', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),

  /** The creator receiving the payout. */
  userId: text('user_id').notNull(),

  /** Opaque reference to the deal/campaign collaboration this payout is for. */
  dealRef: text('deal_ref').notNull(),

  /** Gross amount in minor currency units (paise / cents). */
  grossAmountMinor: integer('gross_amount_minor').notNull(),

  /** Commission deducted in minor currency units. */
  commissionMinor: integer('commission_minor').notNull(),

  /** Creator share = gross − commission, in minor currency units. */
  creatorShareMinor: integer('creator_share_minor').notNull(),

  /** Commission percentage applied (snapshot of tier rate at payout time). */
  commissionPct: integer('commission_pct').notNull(),

  /** Tier active at payout time (snapshot — not a FK to subscriptions). */
  tierAtPayout: tierEnum('tier_at_payout').notNull(),

  currency: currencyEnum('currency').notNull(),

  status: dealPayoutStatusEnum('status').notNull().default('pending'),

  /** Idempotency key to prevent duplicate payouts for the same deal. */
  idempotencyKey: text('idempotency_key').notNull(),

  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type DealPayout = typeof dealPayouts.$inferSelect;
export type NewDealPayout = typeof dealPayouts.$inferInsert;
