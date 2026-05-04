// ── Collaborations (submissions) schema ──────────────────────
// Represents content submitted by an approved creator for a campaign.

import { pgTable, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { campaigns } from './campaigns.schema';

export const submissionStatusEnum = pgEnum('submission_status', [
  'Pending_Review',
  'Approved',
  'Revision_Requested',
]);

export const submissions = pgTable('submissions', {
  submissionId: text('submission_id').primaryKey().$defaultFn(() => randomUUID()),
  campaignId: text('campaign_id').notNull().references(() => campaigns.campaignId, { onDelete: 'cascade' }),
  influencerId: text('influencer_id').notNull(),
  contentUrl: text('content_url'),
  contentCaption: text('content_caption'),
  notesToBrand: text('notes_to_brand'),
  revisionNotes: text('revision_notes'),
  status: submissionStatusEnum('status').notNull().default('Pending_Review'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
