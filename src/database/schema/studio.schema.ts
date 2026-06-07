// ── Studio (AI) ──────────────────────────────────────────────
// Saved AI-generated content (hooks, scripts, captions, ideas)
// that an influencer keeps for later use.

import { pgTable, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import { influencers } from './influencers.schema';
import { aiCreationKindEnum } from './enums.schema';

export const aiCreations = pgTable(
  'ai_creations',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    influencerId: text('influencer_id')
      .notNull()
      .references(() => influencers.influencerId, { onDelete: 'cascade' }),
    kind: aiCreationKindEnum('kind').notNull(),
    title: text('title'),
    prompt: text('prompt'),
    content: text('content').notNull(),
    metadata: jsonb('metadata'),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    influencerIdx: index('idx_ai_creations').on(t.influencerId, t.kind, t.createdAt),
  }),
);

export type AiCreation = typeof aiCreations.$inferSelect;
export type NewAiCreation = typeof aiCreations.$inferInsert;
