// ── Engagement / relationship tables ─────────────────────────
// Junctions between influencers, brands, and campaigns. Every FK
// is typed to a concrete entity. Applications/submissions keep a
// small amount of denormalized display data (username) for fast
// brand-dashboard reads, as before.

import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { campaigns } from './campaigns.schema';
import { influencers } from './influencers.schema';
import { brands } from './brands.schema';
import {
  applicationStatusEnum,
  submissionStatusEnum,
  collaborationStatusEnum,
  proposalStatusEnum,
} from './enums.schema';

export const campaignApplications = pgTable(
  'campaign_applications',
  {
    applicationId: text('application_id').primaryKey().$defaultFn(() => randomUUID()),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.campaignId, { onDelete: 'cascade' }),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    username: text('username').notNull().default('unknown'),
    followerCount: integer('follower_count').notNull().default(0),
    status: applicationStatusEnum('status').notNull().default('Pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    campaignIdx: index('idx_applications_campaign').on(t.campaignId),
    influencerIdx: index('idx_applications_influencer').on(t.influencerId),
    statusIdx: index('idx_applications_status').on(t.status),
    uniqueApply: uniqueIndex('uq_application_campaign_influencer').on(t.campaignId, t.influencerId),
  }),
);

export const campaignSubmissions = pgTable(
  'campaign_submissions',
  {
    submissionId: text('submission_id').primaryKey().$defaultFn(() => randomUUID()),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.campaignId, { onDelete: 'cascade' }),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    influencerUsername: text('influencer_username'),
    contentUrl: text('content_url'),
    contentCaption: text('content_caption'),
    notesToBrand: text('notes_to_brand'),
    revisionNotes: text('revision_notes'),
    status: submissionStatusEnum('status').notNull().default('Pending_Review'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    campaignIdx: index('idx_submissions_campaign').on(t.campaignId),
    influencerIdx: index('idx_submissions_influencer').on(t.influencerId),
    statusIdx: index('idx_submissions_status').on(t.status),
  }),
);

export const savedCampaigns = pgTable(
  'saved_campaigns',
  {
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.campaignId, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.influencerId, t.campaignId] }),
    campaignIdx: index('idx_saved_campaigns_campaign').on(t.campaignId),
  }),
);

export const brandFollows = pgTable(
  'brand_follows',
  {
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.brandId, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.influencerId, t.brandId] }),
    brandIdx: index('idx_follows_brand').on(t.brandId),
  }),
);

export const campaignCollaborations = pgTable(
  'campaign_collaborations',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.campaignId, { onDelete: 'cascade' }),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    status: collaborationStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    influencerIdx: index('idx_collab_influencer').on(t.influencerId),
    uniquePair: uniqueIndex('uq_collab_campaign_influencer').on(t.campaignId, t.influencerId),
  }),
);

export const brandProposals = pgTable(
  'brand_proposals',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.brandId, { onDelete: 'cascade' }),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    status: proposalStatusEnum('status').notNull().default('delivered'),
    budgetRange: text('budget_range'),
    deliverables: text('deliverables'),
    message: text('message'),
    heldAt: timestamp('held_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    influencerIdx: index('idx_proposals_influencer').on(t.influencerId, t.createdAt),
    brandIdx: index('idx_proposals_brand').on(t.brandId, t.createdAt),
  }),
);

export type CampaignApplication = typeof campaignApplications.$inferSelect;
export type NewCampaignApplication = typeof campaignApplications.$inferInsert;
export type CampaignSubmission = typeof campaignSubmissions.$inferSelect;
export type NewCampaignSubmission = typeof campaignSubmissions.$inferInsert;
export type SavedCampaign = typeof savedCampaigns.$inferSelect;
export type BrandFollow = typeof brandFollows.$inferSelect;
export type NewBrandFollow = typeof brandFollows.$inferInsert;
export type CampaignCollaboration = typeof campaignCollaborations.$inferSelect;
export type BrandProposal = typeof brandProposals.$inferSelect;
