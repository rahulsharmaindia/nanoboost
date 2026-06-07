// ── Account deletion requests ────────────────────────────────
// Meta Platform Terms compliance. Subject is polymorphic
// (influencer | brand) via (subject_type, subject_id).

import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { partyTypeEnum, deletionStatusEnum } from './enums.schema';

export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    subjectType: partyTypeEnum('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    confirmationCode: text('confirmation_code').notNull().unique(),
    status: deletionStatusEnum('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    subjectIdx: index('idx_deletion_subject').on(t.subjectType, t.subjectId),
  }),
);

export type AccountDeletionRequest = typeof accountDeletionRequests.$inferSelect;
export type NewAccountDeletionRequest = typeof accountDeletionRequests.$inferInsert;
