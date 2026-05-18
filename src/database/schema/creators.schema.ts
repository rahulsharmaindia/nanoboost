// ── Creator profiles schema ──────────────────────────────────

import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { users } from './users.schema';

export const creatorProfiles = pgTable('creator_profiles', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  username: text('username'),
  displayName: text('display_name'),
  bio: text('bio'),
  profilePictureUrl: text('profile_picture_url'),
  followerCount: integer('follower_count').default(0),
  followsCount: integer('follows_count').default(0),
  mediaCount: integer('media_count').default(0),
  niche: text('niche'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type CreatorProfile = typeof creatorProfiles.$inferSelect;
export type NewCreatorProfile = typeof creatorProfiles.$inferInsert;
