// ── in_app_notifications schema ───────────────────────────────────────────
//
// Persists in-app notification rows that the Flutter client reads via the
// notifications endpoint. The InAppNotificationAdapter writes to this table
// when the outbox dispatcher processes an 'in_app' outbox row.
//
// Requirements: 5.1, 5.2, 23.2, 26.3

import { pgTable, text, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const inAppNotifications = pgTable('in_app_notifications', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  /** The user this notification is addressed to. */
  userId: text('user_id').notNull(),
  /** Notification type, e.g. 'proposal_held', 'payment_failed', 'renewal_reminder'. */
  type: text('type').notNull(),
  /** Arbitrary payload surfaced to the Flutter client. */
  payload: jsonb('payload').notNull(),
  /** Whether the user has read this notification. */
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type InAppNotification = typeof inAppNotifications.$inferSelect;
export type NewInAppNotification = typeof inAppNotifications.$inferInsert;
