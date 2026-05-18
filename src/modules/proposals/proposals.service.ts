// ── ProposalsService ──────────────────────────────────────────────────────
//
// Handles inbound proposal dispatch from brands to creators.
//
// Dispatch logic (Requirements 5.1, 5.2, 5.3, 5.5, 5.6, 5.10):
//
//   creator tier (cap = 0)
//     → reject with TierLockedError (brand UI should not show creator-tier users)
//
//   growth tier, counter < 3
//     → deliver proposal (status = 'delivered') + increment inbound_proposal counter
//
//   growth tier, counter >= 3
//     → hold proposal (status = 'held_for_upgrade'), do NOT increment counter
//
//   studio tier (cap = -1, unlimited)
//     → deliver proposal + increment counter (no-op for unlimited in CapEnforcer)
//
// The entire dispatch is wrapped in a single DB transaction so the proposal
// insert and counter increment are atomic.
//
// Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.10

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { inboundProposals } from '../../database/schema/inbound_proposals.schema';
import type {
  InboundProposal,
  NewInboundProposal,
} from '../../database/schema/inbound_proposals.schema';
import { subscriptions } from '../../database/schema/subscriptions.schema';
import { usageCounters } from '../../database/schema/usage_counters.schema';
import { SubscriptionsFacade } from '../subscriptions/subscriptions.facade';
import { NotificationsService } from '../notifications/notifications.service';
import { TierLockedError, SubscriptionNotFoundError } from '../subscriptions/subscriptions.errors';
import type { Tier } from '../subscriptions/subscriptions.types';

// ── DTOs ──────────────────────────────────────────────────────────────────

export interface SendProposalParams {
  /** The brand's user id (sender). */
  brandUserId: string;
  /** The creator's user id (recipient). */
  creatorUserId: string;
  /** Brand display name — surfaced to creator even while held. */
  brandName: string;
  /** Budget range as a free-text string (e.g. "₹10,000 – ₹50,000"). */
  budgetRange?: string;
  /** Deliverables description. */
  deliverables?: string;
  /** Free-text message from the brand. */
  message?: string;
}

export interface SendProposalResult {
  proposal: InboundProposal;
  /** Whether the proposal was delivered immediately or held for upgrade. */
  status: 'delivered' | 'held_for_upgrade';
}

// ── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly subscriptionsFacade: SubscriptionsFacade,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Dispatch an inbound proposal from a brand to a creator.
   *
   * Resolves the creator's subscription tier and applies the cap logic:
   *
   *   - `creator` tier (cap = 0): throws `TierLockedError` — brands should
   *     not be able to send proposals to creator-tier users.
   *
   *   - `growth` tier, counter < 3: delivers the proposal and increments
   *     the `inbound_proposal` usage counter via `CapEnforcerService`.
   *
   *   - `growth` tier, counter >= 3: sets proposal status to
   *     `held_for_upgrade` without incrementing the counter.
   *
   *   - `studio` tier (unlimited): delivers the proposal and calls
   *     `tryConsume` (which is a no-op for unlimited caps).
   *
   * The proposal insert and counter increment are atomic within a single
   * DB transaction.
   *
   * Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.10
   */
  async sendProposal(params: SendProposalParams): Promise<SendProposalResult> {
    const { brandUserId, creatorUserId, brandName, budgetRange, deliverables, message } = params;

    return this.db.transaction(async (tx: any) => {
      // ── 1. Resolve creator's active subscription ─────────────────────
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, creatorUserId),
      });

      if (!sub) {
        throw new SubscriptionNotFoundError(creatorUserId);
      }

      const tier = sub.tier as Tier;

      // ── 2. Resolve the inbound_proposal cap for this tier ────────────
      // creator → 0, growth → 3, studio → -1 (unlimited)
      // We read the cap from the facade's capFor helper via the plan.
      // For simplicity we derive it from the tier directly using the
      // known catalog values (same source as capForFeature in types).
      const cap = this.capForTier(tier);

      // ── 3. creator tier: cap === 0 → reject ──────────────────────────
      // Requirement 5.1 (implicit): creator-tier users cannot receive proposals.
      // Requirement 3.3: TIER_LOCKED when cap === 0.
      if (cap === 0) {
        throw new TierLockedError('inbound_proposal', tier, 'growth');
      }

      // ── 4. Determine current counter value ───────────────────────────
      // We need the current counter to decide deliver vs hold.
      // For unlimited (cap === -1), we always deliver.
      let currentCount = 0;

      if (cap !== -1) {
        const counterRow = await tx.query.usageCounters.findFirst({
          where: (uc: typeof usageCounters.$inferSelect, { and: andFn, eq: eqFn }: any) =>
            andFn(
              eqFn(uc.userId, creatorUserId),
              eqFn(uc.feature, 'inbound_proposal'),
              eqFn(uc.periodStart, sub.currentPeriodStart),
            ),
        });
        currentCount = counterRow?.value ?? 0;
      }

      // ── 5. Decide: deliver or hold ───────────────────────────────────
      const shouldHold = cap !== -1 && currentCount >= cap;
      const proposalStatus: 'delivered' | 'held_for_upgrade' = shouldHold
        ? 'held_for_upgrade'
        : 'delivered';

      const now = new Date();

      // ── 6. Insert the proposal row ───────────────────────────────────
      const newProposal: NewInboundProposal = {
        creatorUserId,
        brandUserId,
        brandName,
        budgetRange: budgetRange ?? null,
        deliverables: deliverables ?? null,
        message: message ?? null,
        status: proposalStatus,
        heldAt: shouldHold ? now : null,
      };

      const inserted = await tx
        .insert(inboundProposals)
        .values(newProposal)
        .returning();

      const proposal: InboundProposal = inserted[0];

      // ── 7. Increment counter if delivering ───────────────────────────
      // Requirement 5.1: deliver + increment when under cap.
      // For unlimited (studio), tryConsume is a no-op (returns allowed: true).
      if (!shouldHold) {
        // Atomic conditional increment via INSERT … ON CONFLICT DO UPDATE.
        // We call this directly on the tx rather than going through the
        // facade (which opens its own transaction) to keep everything atomic.
        await this.incrementInboundCounter(tx, creatorUserId, sub, cap);
      }

      // ── 8. Schedule in-app notification ─────────────────────────────
      // Requirement 5.1: notify creator within 60s when delivered.
      // Requirement 5.2: notify creator with upgrade prompt when held.
      if (proposalStatus === 'delivered') {
        await this.notificationsService.scheduleInTx(tx, {
          type: 'in_app',
          payload: {
            userId: creatorUserId,
            type: 'proposal_received',
            proposalId: proposal.id,
            brandName,
            budgetRange: budgetRange ?? null,
            deliverables: deliverables ?? null,
          },
          idempotencyKey: `proposal_received:${proposal.id}`,
        });
      } else {
        // held_for_upgrade — prompt creator to upgrade
        await this.notificationsService.scheduleInTx(tx, {
          type: 'in_app',
          payload: {
            userId: creatorUserId,
            type: 'proposal_held_upgrade_prompt',
            proposalId: proposal.id,
            brandName,
            budgetRange: budgetRange ?? null,
            deliverables: deliverables ?? null,
            reason: 'inbound_proposal_cap_reached',
          },
          idempotencyKey: `proposal_held:${proposal.id}`,
        });
      }

      this.logger.log(
        `Proposal ${proposal.id}: ${proposalStatus} for creator ${creatorUserId} ` +
          `(tier=${tier}, cap=${cap}, counter=${currentCount})`,
      );

      return { proposal, status: proposalStatus };
    });
  }

  /**
   * Release all `held_for_upgrade` proposals for a creator to `delivered`
   * status when they upgrade to `studio` tier.
   *
   * Processes proposals oldest-first. Each released proposal triggers an
   * in-app notification to the creator.
   *
   * Must be called within a DB transaction (pass the tx handle).
   *
   * Requirements: 5.7
   */
  async releaseAllHeldProposals(tx: any, creatorUserId: string): Promise<number> {
    const { asc, eq: eqFn, and: andFn } = await import('drizzle-orm');

    const held = await tx
      .select()
      .from(inboundProposals)
      .where(
        andFn(
          eqFn(inboundProposals.creatorUserId, creatorUserId),
          eqFn(inboundProposals.status, 'held_for_upgrade'),
        ),
      )
      .orderBy(asc(inboundProposals.createdAt));

    const now = new Date();

    for (const proposal of held) {
      await tx
        .update(inboundProposals)
        .set({ status: 'delivered', updatedAt: now })
        .where(eqFn(inboundProposals.id, proposal.id));

      await this.notificationsService.scheduleInTx(tx, {
        type: 'in_app',
        payload: {
          userId: creatorUserId,
          type: 'proposal_released',
          proposalId: proposal.id,
          brandName: proposal.brandName,
          budgetRange: proposal.budgetRange,
          deliverables: proposal.deliverables,
        },
        idempotencyKey: `proposal_released:${proposal.id}:${now.toISOString()}`,
      });
    }

    this.logger.log(
      `Released ${held.length} held proposal(s) for creator ${creatorUserId} after studio upgrade`,
    );

    return held.length;
  }

  /**
   * Release up to 3 oldest `held_for_upgrade` proposals to `delivered`
   * at period end (counter reset). Called by PeriodAdvanceScheduler.
   *
   * Must be called within a DB transaction (pass the tx handle).
   *
   * Requirements: 5.8
   */
  async releaseHeldProposalsOnPeriodReset(tx: any, creatorUserId: string): Promise<number> {
    const { asc, eq: eqFn, and: andFn } = await import('drizzle-orm');

    const held = await tx
      .select()
      .from(inboundProposals)
      .where(
        andFn(
          eqFn(inboundProposals.creatorUserId, creatorUserId),
          eqFn(inboundProposals.status, 'held_for_upgrade'),
        ),
      )
      .orderBy(asc(inboundProposals.createdAt))
      .limit(3);

    const now = new Date();

    for (const proposal of held) {
      await tx
        .update(inboundProposals)
        .set({ status: 'delivered', updatedAt: now })
        .where(eqFn(inboundProposals.id, proposal.id));

      await this.notificationsService.scheduleInTx(tx, {
        type: 'in_app',
        payload: {
          userId: creatorUserId,
          type: 'proposal_released',
          proposalId: proposal.id,
          brandName: proposal.brandName,
          budgetRange: proposal.budgetRange,
          deliverables: proposal.deliverables,
        },
        idempotencyKey: `proposal_released:${proposal.id}:${now.toISOString()}`,
      });
    }

    this.logger.log(
      `Released ${held.length} held proposal(s) for creator ${creatorUserId} at period reset`,
    );

    return held.length;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Returns the inbound_proposal cap for a given tier.
   *
   * Mirrors the catalog seed values:
   *   creator → 0   (locked)
   *   growth  → 3
   *   studio  → -1  (unlimited)
   *
   * This avoids a plan table lookup inside the transaction for a value
   * that is stable and known at compile time. If the catalog values change,
   * update this method accordingly.
   */
  private capForTier(tier: Tier): number {
    switch (tier) {
      case 'creator': return 0;
      case 'growth':  return 3;
      case 'studio':  return -1;
    }
  }

  /**
   * Atomically increment the `inbound_proposal` usage counter for the
   * creator within the caller's transaction.
   *
   * Uses INSERT … ON CONFLICT DO UPDATE so the first proposal in a period
   * creates the row and subsequent ones increment it.
   *
   * For unlimited caps (cap === -1) this is a no-op — we still insert/update
   * the row for observability but the cap check in sendProposal already
   * guarantees we never block on it.
   *
   * Requirements: 5.1, 3.1
   */
  private async incrementInboundCounter(
    tx: any,
    userId: string,
    sub: { currentPeriodStart: Date; currentPeriodEnd: Date },
    cap: number,
  ): Promise<void> {
    const { sql, lt } = await import('drizzle-orm');

    if (cap === -1) {
      // Unlimited — just upsert the row for observability; no cap guard needed.
      await tx
        .insert(usageCounters)
        .values({
          userId,
          feature: 'inbound_proposal',
          periodStart: sub.currentPeriodStart,
          periodEnd: sub.currentPeriodEnd,
          value: 1,
        })
        .onConflictDoUpdate({
          target: [
            usageCounters.userId,
            usageCounters.feature,
            usageCounters.periodStart,
          ],
          set: {
            value: sql`${usageCounters.value} + 1`,
            updatedAt: new Date(),
          },
        });
      return;
    }

    // Finite cap — only increment when value < cap (atomic guard).
    await tx
      .insert(usageCounters)
      .values({
        userId,
        feature: 'inbound_proposal',
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        value: 1,
      })
      .onConflictDoUpdate({
        target: [
          usageCounters.userId,
          usageCounters.feature,
          usageCounters.periodStart,
        ],
        set: {
          value: sql`${usageCounters.value} + 1`,
          updatedAt: new Date(),
        },
        where: lt(usageCounters.value, cap),
      });
  }
}
