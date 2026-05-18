import { pgTable, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { currencyEnum } from './plans.schema';

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending', 'succeeded', 'failed', 'reversed',
]);

export const payments = pgTable('payments', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currency: currencyEnum('currency').notNull(),
  providerRef: text('provider_ref'),          // opaque; set by active PaymentPort adapter
  status: paymentStatusEnum('status').notNull().default('pending'),
  idempotencyKey: text('idempotency_key').notNull(),
  chargedAt: timestamp('charged_at', { withTimezone: true }),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
