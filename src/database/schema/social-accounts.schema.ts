// ── Social accounts schema ───────────────────────────────────
// Stores connected Instagram/Meta accounts for creators.
// Tokens are stored here — never returned to the Flutter client.

import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { users } from './users.schema';

export const socialAccounts = pgTable('social_accounts', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('instagram'),
  providerUserId: text('provider_user_id').notNull(), // Instagram user_id
  accessToken: text('access_token').notNull(),        // Never returned to client
  username: text('username'),
  isConnected: boolean('is_connected').notNull().default(true),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  disconnectedAt: timestamp('disconnected_at'),
});

export type SocialAccount = typeof socialAccounts.$inferSelect;
export type NewSocialAccount = typeof socialAccounts.$inferInsert;
