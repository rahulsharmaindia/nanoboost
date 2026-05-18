import { pgTable, text, timestamp, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const subscriptionEventTypeEnum = pgEnum('subscription_event_type', [
  'subscription_created',
  'tier_upgraded',
  'tier_downgrade_requested',
  'tier_downgrade_applied',
  'cancellation_requested',
  'cancellation_applied',
  'cancellation_resumed',
  'renewal_succeeded',
  'renewal_failed',
  'payment_retry_succeeded',
  'subscription_lapsed',
  'addon_purchased',
  'addon_canceled',
  'addon_renewal_succeeded',
  'addon_renewal_failed',
  'addon_lapsed',
  'payment_reversed',
]);

export const subscriptionEvents = pgTable('subscription_events', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull(),
  subscriptionId: text('subscription_id'),
  eventType: subscriptionEventTypeEnum('event_type').notNull(),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id'),
  beforeSnapshot: jsonb('before_snapshot'),
  afterSnapshot: jsonb('after_snapshot'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byUser: index('events_user_idx').on(t.userId, t.createdAt),
}));

export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type NewSubscriptionEvent = typeof subscriptionEvents.$inferInsert;
