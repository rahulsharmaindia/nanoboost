// ── Proposals (applications) schema ─────────────────────────
// Represents a creator's application to a campaign.

import { pgTable, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { campaigns } from './campaigns.schema';

export const applicationStatusEnum = pgEnum('application_status', [
  'Pending',
  'Approved',
  'Rejected',
]);

export const applications = pgTable('applications', {
  applicationId: text('application_id').primaryKey().$defaultFn(() => randomUUID()),
  campaignId: text('campaign_id').notNull().references(() => campaigns.campaignId, { onDelete: 'cascade' }),
  influencerId: text('influencer_id').notNull(), // Instagram user ID
  username: text('username').notNull().default('unknown'),
  followerCount: integer('follower_count').notNull().default(0),
  status: applicationStatusEnum('status').notNull().default('Pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
