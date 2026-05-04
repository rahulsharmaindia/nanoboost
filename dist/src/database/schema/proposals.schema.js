"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applications = exports.applicationStatusEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const crypto_1 = require("crypto");
const campaigns_schema_1 = require("./campaigns.schema");
exports.applicationStatusEnum = (0, pg_core_1.pgEnum)('application_status', [
    'Pending',
    'Approved',
    'Rejected',
]);
exports.applications = (0, pg_core_1.pgTable)('applications', {
    applicationId: (0, pg_core_1.text)('application_id').primaryKey().$defaultFn(() => (0, crypto_1.randomUUID)()),
    campaignId: (0, pg_core_1.text)('campaign_id').notNull().references(() => campaigns_schema_1.campaigns.campaignId, { onDelete: 'cascade' }),
    influencerId: (0, pg_core_1.text)('influencer_id').notNull(),
    username: (0, pg_core_1.text)('username').notNull().default('unknown'),
    followerCount: (0, pg_core_1.integer)('follower_count').notNull().default(0),
    status: (0, exports.applicationStatusEnum)('status').notNull().default('Pending'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
//# sourceMappingURL=proposals.schema.js.map