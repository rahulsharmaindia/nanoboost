"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submissions = exports.submissionStatusEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const crypto_1 = require("crypto");
const campaigns_schema_1 = require("./campaigns.schema");
exports.submissionStatusEnum = (0, pg_core_1.pgEnum)('submission_status', [
    'Pending_Review',
    'Approved',
    'Revision_Requested',
]);
exports.submissions = (0, pg_core_1.pgTable)('submissions', {
    submissionId: (0, pg_core_1.text)('submission_id').primaryKey().$defaultFn(() => (0, crypto_1.randomUUID)()),
    campaignId: (0, pg_core_1.text)('campaign_id').notNull().references(() => campaigns_schema_1.campaigns.campaignId, { onDelete: 'cascade' }),
    influencerId: (0, pg_core_1.text)('influencer_id').notNull(),
    contentUrl: (0, pg_core_1.text)('content_url'),
    contentCaption: (0, pg_core_1.text)('content_caption'),
    notesToBrand: (0, pg_core_1.text)('notes_to_brand'),
    revisionNotes: (0, pg_core_1.text)('revision_notes'),
    status: (0, exports.submissionStatusEnum)('status').notNull().default('Pending_Review'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
//# sourceMappingURL=collaborations.schema.js.map