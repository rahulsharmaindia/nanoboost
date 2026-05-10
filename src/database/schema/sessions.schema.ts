// ── Sessions schema ──────────────────────────────────────────
// DB-backed OAuth/auth session store. Replaces the in-memory Map
// that lived in the old SessionService.
//
// A row represents an ongoing or completed session for either:
//   • a creator (Instagram OAuth, accessToken + providerUserId populated)
//   • a brand   (businessId populated)
//
// Sessions with status='pending' are created at the start of OAuth
// and promoted to 'authenticated' after a successful callback.

import { pgTable, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const sessionStatusEnum = pgEnum('session_status', [
  'pending',
  'authenticated',
  'error',
]);

export const sessions = pgTable(
  'sessions',
  {
    sessionId: text('session_id').primaryKey().$defaultFn(() => randomUUID()),
    // Creator fields
    accessToken: text('access_token'),
    providerUserId: text('provider_user_id'), // Instagram user_id
    // Brand fields
    businessId: text('business_id'),
    // Common
    status: sessionStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => ({
    businessIdIdx: index('idx_sessions_business_id').on(table.businessId),
    providerUserIdx: index('idx_sessions_provider_user_id').on(table.providerUserId),
    expiresAtIdx: index('idx_sessions_expires_at').on(table.expiresAt),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
