"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountDeletionRequests = exports.deletionStatusEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const crypto_1 = require("crypto");
exports.deletionStatusEnum = (0, pg_core_1.pgEnum)('deletion_status', [
    'pending',
    'processing',
    'completed',
    'failed',
]);
exports.accountDeletionRequests = (0, pg_core_1.pgTable)('account_deletion_requests', {
    id: (0, pg_core_1.text)('id').primaryKey().$defaultFn(() => (0, crypto_1.randomUUID)()),
    userId: (0, pg_core_1.text)('user_id').notNull(),
    confirmationCode: (0, pg_core_1.text)('confirmation_code').notNull().unique(),
    status: (0, exports.deletionStatusEnum)('status').notNull().default('pending'),
    requestedAt: (0, pg_core_1.timestamp)('requested_at').defaultNow().notNull(),
    completedAt: (0, pg_core_1.timestamp)('completed_at'),
});
//# sourceMappingURL=account-deletion.schema.js.map