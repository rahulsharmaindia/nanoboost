// ── Account deletion requests schema ────────────────────────

import { pgTable, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const deletionStatusEnum = pgEnum('deletion_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const accountDeletionRequests = pgTable('account_deletion_requests', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull(),
  confirmationCode: text('confirmation_code').notNull().unique(),
  status: deletionStatusEnum('status').notNull().default('pending'),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export type AccountDeletionRequest = typeof accountDeletionRequests.$inferSelect;
export type NewAccountDeletionRequest = typeof accountDeletionRequests.$inferInsert;
