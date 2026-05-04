"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialAccounts = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const crypto_1 = require("crypto");
const users_schema_1 = require("./users.schema");
exports.socialAccounts = (0, pg_core_1.pgTable)('social_accounts', {
    id: (0, pg_core_1.text)('id').primaryKey().$defaultFn(() => (0, crypto_1.randomUUID)()),
    userId: (0, pg_core_1.text)('user_id').notNull().references(() => users_schema_1.users.id, { onDelete: 'cascade' }),
    provider: (0, pg_core_1.text)('provider').notNull().default('instagram'),
    providerUserId: (0, pg_core_1.text)('provider_user_id').notNull(),
    accessToken: (0, pg_core_1.text)('access_token').notNull(),
    username: (0, pg_core_1.text)('username'),
    isConnected: (0, pg_core_1.boolean)('is_connected').notNull().default(true),
    connectedAt: (0, pg_core_1.timestamp)('connected_at').defaultNow().notNull(),
    disconnectedAt: (0, pg_core_1.timestamp)('disconnected_at'),
});
//# sourceMappingURL=social-accounts.schema.js.map