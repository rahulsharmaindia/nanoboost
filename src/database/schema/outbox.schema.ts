// ── Outbox schema ─────────────────────────────────────────────
// Transactional outbox table for reliable notification dispatch.
// Rows are inserted inside the same DB transaction as the business
// event (e.g. subscription_events insert). A background dispatcher
// polls every 10 s, picks up pending rows, and delivers them via
// the active NotificationPort adapter.
//
// Requirements: 24.5, 26.7

import { pgTable, text, timestamp, jsonb, pgEnum, integer } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const outboxStatusEnum = pgEnum('outbox_status', [
  'pending',
  'processing',
  'sent',
  'failed',
]);

export const outbox = pgTable('outbox', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),

  /** Notification type: 'email' | 'in_app' */
  type: text('type').notNull(),

  /** Notification payload — template id, variables, recipient, etc. */
  payload: jsonb('payload').notNull(),

  /** Current dispatch status. */
  status: outboxStatusEnum('status').notNull().default('pending'),

  /**
   * Idempotency key — unique per logical notification event.
   * Format: '{event_type}:{entity_id}:{user_id}'.
   * ON CONFLICT DO NOTHING prevents duplicate rows for the same event.
   */
  idempotencyKey: text('idempotency_key').notNull().unique(),

  /** Number of dispatch attempts made so far. */
  attempts: integer('attempts').notNull().default(0),

  /** Timestamp when the row was successfully dispatched. */
  processedAt: timestamp('processed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type OutboxEntry = typeof outbox.$inferSelect;
export type NewOutboxEntry = typeof outbox.$inferInsert;
