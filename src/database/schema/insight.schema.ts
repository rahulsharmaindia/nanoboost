// ── Insight (analytics) ──────────────────────────────────────
// Periodic snapshots of Instagram metrics so the app can show
// trends. Live "current" metrics are still fetched from the Graph
// API; this table backs history.

import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { influencers } from './influencers.schema';

export const analyticsSnapshots = pgTable(
  'analytics_snapshots',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    scope: text('scope').notNull(), // 'profile' | 'media:<id>'
    metrics: jsonb('metrics').notNull(),
  },
  (t) => ({
    uniqueSnapshot: uniqueIndex('uq_snapshot_influencer_scope_time').on(
      t.influencerId,
      t.scope,
      t.capturedAt,
    ),
    influencerIdx: index('idx_analytics_influencer').on(t.influencerId, t.capturedAt),
  }),
);

export type AnalyticsSnapshot = typeof analyticsSnapshots.$inferSelect;
