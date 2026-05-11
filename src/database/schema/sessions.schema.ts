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
//
// Token lifetime fields (creator sessions only):
//   - tokenExpiresAt   — when the Instagram long-lived token dies
//                        (populated after a successful long-lived
//                        token exchange; 60 days out).
//   - lastRefreshedAt  — last successful call to /refresh_access_token.
//                        Used to gate Meta's "token must be at least
//                        24 hours old" refresh rule.
//
// The `expiresAt` column is the session-level TTL; it is rolled
// forward whenever we refresh the underlying Meta token.

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
    accessToken: text('access_token'),                       // encrypted at rest (AES-256-GCM)
    providerUserId: text('provider_user_id'),                // Instagram user_id
    tokenExpiresAt: timestamp('token_expires_at'),           // IG long-lived token expiry
    lastRefreshedAt: timestamp('last_refreshed_at'),         // last successful IG refresh
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
