// ── Campaigns ────────────────────────────────────────────────
// Brand campaigns. Single wide table (the create wizard maps 1:1
// to these columns). The key entity-model change vs the legacy
// schema is `brand_id` (FK → brands) replacing the old loose
// `business_id` text column.
//
// NOTE: a future refactor can split the long-tail content/audience/
// guideline fields into 1:1 satellite tables and migrate dates to
// timestamptz + budgets to integer minor units. Kept inline here to
// preserve the working create/update/read paths during the entity
// migration.

import { pgTable, text, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { brands } from './brands.schema';
import { campaignStatusEnum } from './enums.schema';

export const campaigns = pgTable(
  'campaigns',
  {
    campaignId: text('campaign_id').primaryKey().$defaultFn(() => randomUUID()),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.brandId, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    objective: text('objective').notNull(),
    campaignType: text('campaign_type').notNull(),

    // Platform & content
    platform: text('platform').default('Instagram'),
    postTypes: text('post_types'),
    deliverables: text('deliverables'),
    contentCountPerInfluencer: integer('content_count_per_influencer'),
    captionGuidelines: text('caption_guidelines'),
    hashtags: text('hashtags'),
    mentions: text('mentions'),
    handleToTag: text('handle_to_tag'),
    referenceImages: text('reference_images'),

    // Target audience
    ageGroupMin: integer('age_group_min').notNull(),
    ageGroupMax: integer('age_group_max').notNull(),
    gender: text('gender').notNull(),
    targetLocation: text('target_location').notNull(),
    interests: text('interests'),
    languagePreference: text('language_preference'),

    // Budget
    totalBudget: numeric('total_budget').notNull(),
    budgetPerCreator: numeric('budget_per_creator').notNull(),
    paymentModel: text('payment_model').notNull(),
    commissionRate: numeric('commission_rate'),
    productDetails: text('product_details'),
    bonusCriteria: text('bonus_criteria'),
    performanceIncentive: text('performance_incentive'),

    // Timeline (ISO date strings)
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    applicationDeadline: text('application_deadline').notNull(),
    submissionDeadline: text('submission_deadline').notNull(),
    contentDeadline: text('content_deadline').notNull(),
    revisionAllowedCount: integer('revision_allowed_count').default(0),
    reviewTurnaroundHours: integer('review_turnaround_hours'),
    postingTimeWindow: text('posting_time_window'),

    // Creator requirements
    minimumFollowers: integer('minimum_followers').notNull(),
    requiredEngagementRate: numeric('required_engagement_rate').notNull(),
    preferredNiche: text('preferred_niche').notNull(),
    contentStyleExpectations: text('content_style_expectations'),
    audienceGenderRatio: text('audience_gender_ratio'),
    totalSlots: integer('total_slots').notNull(),
    reserveSlots: integer('reserve_slots'),
    priorityInviteList: text('priority_invite_list'),

    // Guidelines
    guidelinesDos: text('guidelines_dos'),
    guidelinesDonts: text('guidelines_donts'),
    brandMessaging: text('brand_messaging'),
    approvalProcessDescription: text('approval_process_description'),
    requireApproval: text('require_approval'),
    autoApproveAfterHours: integer('auto_approve_after_hours'),

    status: campaignStatusEnum('status').notNull().default('Draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    brandIdx: index('idx_campaigns_brand').on(t.brandId),
    nicheIdx: index('idx_campaigns_niche').on(t.preferredNiche),
    deadlineIdx: index('idx_campaigns_app_dl').on(t.applicationDeadline),
    browseIdx: index('idx_campaigns_browse')
      .on(t.status)
      .where(sql`${t.status} in ('Published','Active')`),
  }),
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
