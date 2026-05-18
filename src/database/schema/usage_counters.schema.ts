import { pgTable, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const FEATURES = [
  'application_outbound',
  'inbound_proposal',
  'ai_tool',
] as const;

export const usageCounters = pgTable('usage_counters', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull(),
  feature: text('feature').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  value: integer('value').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqCounter: uniqueIndex('counter_user_feature_period_uniq')
    .on(t.userId, t.feature, t.periodStart),
}));

export type UsageCounter = typeof usageCounters.$inferSelect;
export type NewUsageCounter = typeof usageCounters.$inferInsert;
