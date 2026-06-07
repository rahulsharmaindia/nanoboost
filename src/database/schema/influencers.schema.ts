// ── Influencer entity ────────────────────────────────────────
// Influencers are a first-class entity (not a role on a shared
// users table). Identity is the surrogate `influencer_id`; the
// Instagram user id is an attribute, never a foreign key.

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { sessionStatusEnum } from './enums.schema';

export const influencers = pgTable(
  'influencers',
  {
    influencerId: text('influencer_id').primaryKey().$defaultFn(() => randomUUID()),
    instagramUserId: text('instagram_user_id').notNull().unique(),
    username: text('username'),
    displayName: text('display_name'),
    bio: text('bio'),
    profilePictureUrl: text('profile_picture_url'),
    followerCount: integer('follower_count').notNull().default(0),
    followsCount: integer('follows_count').notNull().default(0),
    mediaCount: integer('media_count').notNull().default(0),
    niche: text('niche'),
    instagramSyncedAt: timestamp('instagram_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    usernameIdx: index('idx_influencers_username').on(t.username),
    nicheIdx: index('idx_influencers_niche').on(t.niche),
  }),
);

// The single home for Instagram tokens. One active row per
// (influencer, provider). Tokens are encrypted at rest.
export const influencerSocialAccounts = pgTable(
  'influencer_social_accounts',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('instagram'),
    providerUserId: text('provider_user_id').notNull(),
    accessToken: text('access_token').notNull(), // encrypted (AES-256-GCM)
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    username: text('username'),
    isConnected: boolean('is_connected').notNull().default(true),
    connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  },
  (t) => ({
    activeUnique: uniqueIndex('uq_social_active')
      .on(t.influencerId, t.provider)
      .where(sql`${t.isConnected}`),
    providerUserIdx: index('idx_social_provider_user').on(t.providerUserId),
  }),
);

// Transient OAuth handshake state (was the `pending` session rows).
// Short TTL, purged after callback.
export const influencerOauthStates = pgTable('influencer_oauth_states', {
  state: text('state').primaryKey(),
  webRedirectUri: text('web_redirect_uri'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// Authenticated influencer sessions. The session_id is the
// unguessable credential held by the client. One active session
// per influencer (partial unique index).
export const influencerSessions = pgTable(
  'influencer_sessions',
  {
    sessionId: text('session_id').primaryKey().$defaultFn(() => randomUUID()),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    status: sessionStatusEnum('status').notNull().default('authenticated'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    activeUnique: uniqueIndex('uq_inf_session_active')
      .on(t.influencerId)
      .where(sql`${t.status} = 'authenticated'`),
    expiresIdx: index('idx_inf_session_expires').on(t.expiresAt),
  }),
);

export type Influencer = typeof influencers.$inferSelect;
export type NewInfluencer = typeof influencers.$inferInsert;
export type InfluencerSocialAccount = typeof influencerSocialAccounts.$inferSelect;
export type NewInfluencerSocialAccount = typeof influencerSocialAccounts.$inferInsert;
export type InfluencerOauthState = typeof influencerOauthStates.$inferSelect;
export type NewInfluencerOauthState = typeof influencerOauthStates.$inferInsert;
export type InfluencerSession = typeof influencerSessions.$inferSelect;
export type NewInfluencerSession = typeof influencerSessions.$inferInsert;
