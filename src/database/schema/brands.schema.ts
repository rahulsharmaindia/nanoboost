// ── Brand entity ─────────────────────────────────────────────
// Brands are a first-class entity (not a role on a shared users
// table). `brand_id` is the surrogate identity; `business_id` is a
// human-readable slug used for login/display.

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { sessionStatusEnum } from './enums.schema';

export const brands = pgTable('brands', {
  brandId: text('brand_id').primaryKey().$defaultFn(() => randomUUID()),
  businessId: text('business_id').notNull().unique(),
  name: text('name').notNull(),
  logo: text('logo'),
  industry: text('industry').notNull(),
  website: text('website'),
  description: text('description'),
  socialLinks: jsonb('social_links').$type<Record<string, string> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Password hashes kept separate from the profile so profile reads
// never accidentally expose credentials.
export const brandCredentials = pgTable('brand_credentials', {
  brandId: text('brand_id')
    .primaryKey()
    .references(() => brands.brandId, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const brandSessions = pgTable(
  'brand_sessions',
  {
    sessionId: text('session_id').primaryKey().$defaultFn(() => randomUUID()),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.brandId, { onDelete: 'cascade' }),
    status: sessionStatusEnum('status').notNull().default('authenticated'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    activeUnique: uniqueIndex('uq_brand_session_active')
      .on(t.brandId)
      .where(sql`${t.status} = 'authenticated'`),
    expiresIdx: index('idx_brand_session_expires').on(t.expiresAt),
  }),
);

export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
export type BrandCredential = typeof brandCredentials.$inferSelect;
export type NewBrandCredential = typeof brandCredentials.$inferInsert;
export type BrandSession = typeof brandSessions.$inferSelect;
export type NewBrandSession = typeof brandSessions.$inferInsert;
