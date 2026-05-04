"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creatorProfiles = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const crypto_1 = require("crypto");
const users_schema_1 = require("./users.schema");
exports.creatorProfiles = (0, pg_core_1.pgTable)('creator_profiles', {
    id: (0, pg_core_1.text)('id').primaryKey().$defaultFn(() => (0, crypto_1.randomUUID)()),
    userId: (0, pg_core_1.text)('user_id').notNull().references(() => users_schema_1.users.id, { onDelete: 'cascade' }).unique(),
    username: (0, pg_core_1.text)('username'),
    displayName: (0, pg_core_1.text)('display_name'),
    bio: (0, pg_core_1.text)('bio'),
    profilePictureUrl: (0, pg_core_1.text)('profile_picture_url'),
    followerCount: (0, pg_core_1.integer)('follower_count').default(0),
    followsCount: (0, pg_core_1.integer)('follows_count').default(0),
    mediaCount: (0, pg_core_1.integer)('media_count').default(0),
    niche: (0, pg_core_1.text)('niche'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
//# sourceMappingURL=creators.schema.js.map