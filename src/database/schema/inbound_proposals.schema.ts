// ── Inbound Proposals schema ──────────────────────────────────────────────
//
// Represents a brand's inbound proposal sent to a creator.
// Proposals may be delivered immediately or held in a queue when the
// creator's monthly inbound_proposal cap is reached (held_for_upgrade).
//
// Requirements: 5.1, 5.2, 5.3, 5.7, 5.8, 5.9, 5.10

import { pgTable, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const inboundProposalStatusEnum = pgEnum('inbound_proposal_status', [
  'delivered',
  'held_for_upgrade',
  'auto_declined',
  'declined',
  'withdrawn',
]);

export const inboundProposals = pgTable('inbound_proposals', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),

  /** The creator (recipient) user id. */
  creatorUserId: text('creator_user_id').notNull(),

  /** The brand (sender) user id. */
  brandUserId: text('brand_user_id').notNull(),

  /** Proposal status — drives the held-queue lifecycle. */
  status: inboundProposalStatusEnum('status').notNull().default('delivered'),

  /** Brand name — surfaced to creator even while held. */
  brandName: text('brand_name').notNull(),

  /** Budget range as a free-text string (e.g. "₹10,000 – ₹50,000"). */
  budgetRange: text('budget_range'),

  /** Deliverables description. */
  deliverables: text('deliverables'),

  /** Free-text message from the brand. */
  message: text('message'),

  /**
   * Timestamp when the proposal entered `held_for_upgrade` status.
   * Used by the 90-day auto-decline sweeper (Req 5.9).
   */
  heldAt: timestamp('held_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byCreator: index('inbound_proposals_creator_idx').on(t.creatorUserId, t.createdAt),
  byBrand: index('inbound_proposals_brand_idx').on(t.brandUserId, t.createdAt),
}));

export type InboundProposal = typeof inboundProposals.$inferSelect;
export type NewInboundProposal = typeof inboundProposals.$inferInsert;
