// ── Staff / back-office entity ───────────────────────────────
// Internal users who manage brands and influencers. Access is
// governed by RBAC roles (staff_roles) rather than ownership.

import { pgTable, text, boolean, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { staffRoleEnum, staffStatusEnum, sessionStatusEnum } from './enums.schema';

export const staff = pgTable('staff', {
  staffId: text('staff_id').primaryKey().$defaultFn(() => randomUUID()),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  status: staffStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const staffRoles = pgTable(
  'staff_roles',
  {
    staffId: text('staff_id')
      .notNull()
      .references(() => staff.staffId, { onDelete: 'cascade' }),
    role: staffRoleEnum('role').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.staffId, t.role] }),
  }),
);

// Optional fine-grained permission matrix. Populate when the role
// enum alone is insufficient.
export const staffRolePermissions = pgTable(
  'staff_role_permissions',
  {
    role: staffRoleEnum('role').notNull(),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.role, t.resource, t.action] }),
  }),
);

export const staffSessions = pgTable(
  'staff_sessions',
  {
    sessionId: text('session_id').primaryKey().$defaultFn(() => randomUUID()),
    staffId: text('staff_id')
      .notNull()
      .references(() => staff.staffId, { onDelete: 'cascade' }),
    status: sessionStatusEnum('status').notNull().default('authenticated'),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    expiresIdx: index('idx_staff_session_expires').on(t.expiresAt),
  }),
);

export type Staff = typeof staff.$inferSelect;
export type NewStaff = typeof staff.$inferInsert;
export type StaffRole = typeof staffRoles.$inferSelect;
export type StaffSession = typeof staffSessions.$inferSelect;
