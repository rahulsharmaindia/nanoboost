"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaigns = exports.campaignStatusEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const crypto_1 = require("crypto");
exports.campaignStatusEnum = (0, pg_core_1.pgEnum)('campaign_status', [
    'Draft',
    'Published',
    'Active',
    'Completed',
    'Cancelled',
    'Archived',
]);
exports.campaigns = (0, pg_core_1.pgTable)('campaigns', {
    campaignId: (0, pg_core_1.text)('campaign_id').primaryKey().$defaultFn(() => (0, crypto_1.randomUUID)()),
    businessId: (0, pg_core_1.text)('business_id').notNull(),
    title: (0, pg_core_1.text)('title').notNull(),
    description: (0, pg_core_1.text)('description').notNull(),
    objective: (0, pg_core_1.text)('objective').notNull(),
    campaignType: (0, pg_core_1.text)('campaign_type').notNull(),
    ageGroupMin: (0, pg_core_1.integer)('age_group_min').notNull(),
    ageGroupMax: (0, pg_core_1.integer)('age_group_max').notNull(),
    gender: (0, pg_core_1.text)('gender').notNull(),
    targetLocation: (0, pg_core_1.text)('target_location').notNull(),
    totalBudget: (0, pg_core_1.numeric)('total_budget').notNull(),
    budgetPerCreator: (0, pg_core_1.numeric)('budget_per_creator').notNull(),
    paymentModel: (0, pg_core_1.text)('payment_model').notNull(),
    startDate: (0, pg_core_1.text)('start_date').notNull(),
    endDate: (0, pg_core_1.text)('end_date').notNull(),
    applicationDeadline: (0, pg_core_1.text)('application_deadline').notNull(),
    submissionDeadline: (0, pg_core_1.text)('submission_deadline').notNull(),
    contentDeadline: (0, pg_core_1.text)('content_deadline').notNull(),
    minimumFollowers: (0, pg_core_1.integer)('minimum_followers').notNull(),
    requiredEngagementRate: (0, pg_core_1.numeric)('required_engagement_rate').notNull(),
    preferredNiche: (0, pg_core_1.text)('preferred_niche').notNull(),
    totalSlots: (0, pg_core_1.integer)('total_slots').notNull(),
    reserveSlots: (0, pg_core_1.integer)('reserve_slots'),
    requireApproval: (0, pg_core_1.text)('require_approval'),
    autoApproveAfterHours: (0, pg_core_1.integer)('auto_approve_after_hours'),
    status: (0, exports.campaignStatusEnum)('status').notNull().default('Draft'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
//# sourceMappingURL=campaigns.schema.js.map