// ── Campaigns schema ─────────────────────────────────────────

import { pgTable, text, integer, numeric, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const campaignStatusEnum = pgEnum('campaign_status', [
  'Draft',
  'Published',
  'Active',
  'Completed',
  'Cancelled',
  'Archived',
]);

export const campaigns = pgTable('campaigns', {
  campaignId: text('campaign_id').primaryKey().$defaultFn(() => randomUUID()),
  businessId: text('business_id').notNull(), // brand's businessId (human-readable)
  title: text('title').notNull(),
  description: text('description').notNull(),
  objective: text('objective').notNull(),
  campaignType: text('campaign_type').notNull(),

  // Platform & Content
  platform: text('platform').default('Instagram'),
  postTypes: text('post_types'),                          // JSON array
  deliverables: text('deliverables'),                     // JSON: {posts, reels, stories}
  contentCountPerInfluencer: integer('content_count_per_influencer'),
  captionGuidelines: text('caption_guidelines'),
  hashtags: text('hashtags'),                             // JSON array
  mentions: text('mentions'),                             // JSON array
  handleToTag: text('handle_to_tag'),
  referenceImages: text('reference_images'),              // JSON array of URLs

  // Target Audience
  ageGroupMin: integer('age_group_min').notNull(),
  ageGroupMax: integer('age_group_max').notNull(),
  gender: text('gender').notNull(),
  targetLocation: text('target_location').notNull(),
  interests: text('interests'),                           // JSON array
  languagePreference: text('language_preference'),

  // Budget
  totalBudget: numeric('total_budget').notNull(),
  budgetPerCreator: numeric('budget_per_creator').notNull(),
  paymentModel: text('payment_model').notNull(),
  commissionRate: numeric('commission_rate'),
  productDetails: text('product_details'),
  bonusCriteria: text('bonus_criteria'),
  performanceIncentive: text('performance_incentive'),

  // Timeline
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  applicationDeadline: text('application_deadline').notNull(),
  submissionDeadline: text('submission_deadline').notNull(),
  contentDeadline: text('content_deadline').notNull(),
  revisionAllowedCount: integer('revision_allowed_count').default(0),
  reviewTurnaroundHours: integer('review_turnaround_hours'),
  postingTimeWindow: text('posting_time_window'),

  // Creator Requirements
  minimumFollowers: integer('minimum_followers').notNull(),
  requiredEngagementRate: numeric('required_engagement_rate').notNull(),
  preferredNiche: text('preferred_niche').notNull(),
  contentStyleExpectations: text('content_style_expectations'),
  audienceGenderRatio: text('audience_gender_ratio'),
  totalSlots: integer('total_slots').notNull(),
  reserveSlots: integer('reserve_slots'),
  priorityInviteList: text('priority_invite_list'),       // JSON array

  // Guidelines
  guidelinesDos: text('guidelines_dos'),
  guidelinesDonts: text('guidelines_donts'),
  brandMessaging: text('brand_messaging'),
  approvalProcessDescription: text('approval_process_description'),
  requireApproval: text('require_approval'),
  autoApproveAfterHours: integer('auto_approve_after_hours'),

  // Metadata
  status: campaignStatusEnum('status').notNull().default('Draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
