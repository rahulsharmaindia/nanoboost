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
import {
  sessionStatusEnum,
  profileCompletionStatusEnum,
  verificationStatusEnum,
} from './enums.schema';

export const influencers = pgTable(
  'influencers',
  {
    influencerId: text('influencer_id').primaryKey().$defaultFn(() => randomUUID()),
    // Google-first identity: influencers can exist before linking Instagram.
    googleUserId: text('google_user_id'),
    // Instagram user id is now an optional attribute (nullable), not a required key.
    instagramUserId: text('instagram_user_id'),
    // Instagram handle supplied during onboarding (free text).
    instagramHandle: text('instagram_handle'),
    username: text('username'),
    displayName: text('display_name'),
    bio: text('bio'),
    profilePictureUrl: text('profile_picture_url'),
    followerCount: integer('follower_count').notNull().default(0),
    followsCount: integer('follows_count').notNull().default(0),
    mediaCount: integer('media_count').notNull().default(0),
    niche: text('niche'),
    // Mandatory profile-completion tracking for the onboarding hard-lock.
    profileCompletionStatus: profileCompletionStatusEnum('profile_completion_status')
      .notNull()
      .default('incomplete'),
    // Contact details captured from the Google identity / onboarding, with
    // their (currently always unverified) verification state.
    email: text('email'),
    emailVerificationStatus: verificationStatusEnum('email_verification_status')
      .notNull()
      .default('unverified'),
    contactNumber: text('contact_number'),
    contactVerificationStatus: verificationStatusEnum('contact_verification_status')
      .notNull()
      .default('unverified'),
    instagramSyncedAt: timestamp('instagram_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    usernameIdx: index('idx_influencers_username').on(t.username),
    nicheIdx: index('idx_influencers_niche').on(t.niche),
    googleUserIdx: index('idx_influencers_google_user').on(t.googleUserId),
    // Uniqueness of instagram_user_id applies only to rows where it is set,
    // so multiple Google-first influencers (null instagram_user_id) can coexist.
    instagramUserIdUnique: uniqueIndex('uq_influencers_instagram_user_id')
      .on(t.instagramUserId)
      .where(sql`${t.instagramUserId} IS NOT NULL`),
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
//
// Two tokens are minted per flow:
//   • state      — the public CSRF token that travels to Instagram and
//                  back via the redirect. NOT a credential.
//   • pollToken  — a private secret kept by the client and never sent
//                  to Instagram. The client polls with it to learn the
//                  issued session id (fallback for environments where
//                  the redirect-back is unreliable, e.g. iOS PWA
//                  standalone). The poll is single-use.
//
// resultStatus flips pending → authenticated|error at callback time;
// sessionId holds the issued influencer session once authenticated.
export const influencerOauthStates = pgTable(
  'influencer_oauth_states',
  {
    state: text('state').primaryKey(),
    pollToken: text('poll_token').notNull(),
    webRedirectUri: text('web_redirect_uri'),
    resultStatus: text('result_status').notNull().default('pending'),
    sessionId: text('session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pollTokenIdx: uniqueIndex('uq_oauth_poll_token').on(t.pollToken),
  }),
);

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
