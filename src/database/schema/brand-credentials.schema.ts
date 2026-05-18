// ── Brand credentials schema ─────────────────────────────────
// Stores password hashes for brand login. Kept separate from
// brand_profiles so credential data is never accidentally returned
// by profile queries.

import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { brandProfiles } from './brands.schema';

export const brandCredentials = pgTable('brand_credentials', {
  businessId: text('business_id')
    .primaryKey()
    .references(() => brandProfiles.businessId, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type BrandCredential = typeof brandCredentials.$inferSelect;
export type NewBrandCredential = typeof brandCredentials.$inferInsert;
