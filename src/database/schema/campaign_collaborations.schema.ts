// ── Campaign Collaborations schema ───────────────────────────
// Tracks the active/inactive state of a creator's participation
// in a campaign. Used by CapEnforcerService.checkConcurrent to
// count how many campaigns a creator is concurrently active in.
//
// The concurrent active campaigns cap (concurrentCampaignsCap) is
// a Concurrent State — not a Usage Counter — so it is NOT stored
// in usage_counters. It is derived live from this table.
//
// Requirements: 2.6, 3.4, 4.4

import { pgTable, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { campaigns } from './campaigns.schema';

export const collaborationStatusEnum = pgEnum('collaboration_status', [
  'pending',
  'active',
  'completed',
  'withdrawn',
  'rejected',
]);

export const campaignCollaborations = pgTable('campaign_collaborations', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.campaignId, { onDelete: 'cascade' }),
  creatorUserId: text('creator_user_id').notNull(),
  status: collaborationStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type CampaignCollaboration = typeof campaignCollaborations.$inferSelect;
export type NewCampaignCollaboration = typeof campaignCollaborations.$inferInsert;
