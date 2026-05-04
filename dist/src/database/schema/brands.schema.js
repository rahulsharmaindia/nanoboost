"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.brandProfiles = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const crypto_1 = require("crypto");
const users_schema_1 = require("./users.schema");
exports.brandProfiles = (0, pg_core_1.pgTable)('brand_profiles', {
    id: (0, pg_core_1.text)('id').primaryKey().$defaultFn(() => (0, crypto_1.randomUUID)()),
    userId: (0, pg_core_1.text)('user_id').notNull().references(() => users_schema_1.users.id, { onDelete: 'cascade' }).unique(),
    businessId: (0, pg_core_1.text)('business_id').notNull().unique(),
    name: (0, pg_core_1.text)('name').notNull(),
    logo: (0, pg_core_1.text)('logo'),
    industry: (0, pg_core_1.text)('industry').notNull(),
    website: (0, pg_core_1.text)('website'),
    description: (0, pg_core_1.text)('description'),
    socialLinks: (0, pg_core_1.text)('social_links'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
//# sourceMappingURL=brands.schema.js.map