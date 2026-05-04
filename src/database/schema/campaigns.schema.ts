// ── Campaigns schema ─────────────────────────────────────────

import { pgTable, text, integer, numeric, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { brandProfiles } from './brands.schema';

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
  ageGroupMin: integer('age_group_min').notNull(),
  ageGroupMax: integer('age_group_max').notNull(),
  gender: text('gender').notNull(),
  targetLocation: text('target_location').notNull(),
  totalBudget: numeric('total_budget').notNull(),
  budgetPerCreator: numeric('budget_per_creator').notNull(),
  paymentModel: text('payment_model').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  applicationDeadline: text('application_deadline').notNull(),
  submissionDeadline: text('submission_deadline').notNull(),
  contentDeadline: text('content_deadline').notNull(),
  minimumFollowers: integer('minimum_followers').notNull(),
  requiredEngagementRate: numeric('required_engagement_rate').notNull(),
  preferredNiche: text('preferred_niche').notNull(),
  totalSlots: integer('total_slots').notNull(),
  reserveSlots: integer('reserve_slots'),
  requireApproval: text('require_approval'),
  autoApproveAfterHours: integer('auto_approve_after_hours'),
  status: campaignStatusEnum('status').notNull().default('Draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
