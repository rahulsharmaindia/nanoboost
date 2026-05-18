// ── Follows schema ───────────────────────────────────────────
// Tracks which brands a creator (influencer) is following. The
// follow set previously lived in client-side SharedPreferences;
// moving it to the database means it survives reinstalls and
// follows the creator across devices.
//
// One row per (followerInfluencerId, brandName) pair. We key on
// brandName instead of businessId so brands the creator discovered
// before they registered (i.e. soft references) still work.

import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const brandFollows = pgTable(
  'brand_follows',
  {
    influencerId: text('influencer_id').notNull(),
    brandName: text('brand_name').notNull(),
    businessId: text('business_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    uniqFollow: uniqueIndex('brand_follows_unique')
      .on(table.influencerId, table.brandName),
  }),
);

export type BrandFollow = typeof brandFollows.$inferSelect;
export type NewBrandFollow = typeof brandFollows.$inferInsert;
