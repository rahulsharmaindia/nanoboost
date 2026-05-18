// ── Users schema ─────────────────────────────────────────────
// Core identity table. Role-specific data lives in creator_profiles
// and brand_profiles to keep this table clean.

import { pgTable, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['creator', 'brand', 'admin']);

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Supabase Auth user ID
  email: text('email').notNull().unique(),
  role: userRoleEnum('role').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
