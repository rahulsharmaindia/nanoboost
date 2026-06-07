// ── Platform (infra) ─────────────────────────────────────────
// Cross-cutting infrastructure: polymorphic in-app notifications
// and a transactional outbox for reliable event delivery.

import { pgTable, text, boolean, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { partyTypeEnum, outboxStatusEnum } from './enums.schema';

// Recipient is polymorphic (influencer | brand | staff). No hard
// FK — integrity is enforced in the application layer.
export const inAppNotifications = pgTable(
  'in_app_notifications',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    recipientType: partyTypeEnum('recipient_type').notNull(),
    recipientId: text('recipient_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    recipientIdx: index('idx_notifications_recipient').on(
      t.recipientType,
      t.recipientId,
      t.isRead,
      t.createdAt,
    ),
  }),
);

export const outbox = pgTable(
  'outbox',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    attempts: integer('attempts').notNull().default(0),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pendingIdx: index('idx_outbox_pending')
      .on(t.status, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  }),
);

export type InAppNotification = typeof inAppNotifications.$inferSelect;
export type OutboxMessage = typeof outbox.$inferSelect;
