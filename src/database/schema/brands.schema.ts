// ── Brand profiles schema ────────────────────────────────────

import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { users } from './users.schema';

export const brandProfiles = pgTable('brand_profiles', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  businessId: text('business_id').notNull().unique(), // human-readable brand handle
  name: text('name').notNull(),
  logo: text('logo'),
  industry: text('industry').notNull(),
  website: text('website'),
  description: text('description'),
  // Object of platform → URL. Stored as jsonb so future code can
  // index / query individual links without parsing a string blob.
  socialLinks: jsonb('social_links').$type<Record<string, string> | null>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type BrandProfile = typeof brandProfiles.$inferSelect;
export type NewBrandProfile = typeof brandProfiles.$inferInsert;
