// ── Integration test: held proposal queue overflow + period release ──────
//
// Task 23.7 — Validates the end-to-end behaviour of the inbound-proposal
// held queue for a Growth-tier creator across multiple period rollovers.
//
// Scenario:
//   1. Growth-tier creator (cap = 3), counter starts at 0.
//   2. Brand sends N = 8 proposals back-to-back.
//      → first 3 delivered (counter increments 0→3),
//        next 5 stored as `held_for_upgrade` (counter stays at 3).
//   3. Period rolls over (counter reset to 0). Period-advance scheduler
//      invokes `releaseHeldProposalsOnPeriodReset` (Req 5.8) which
//      releases up to 3 oldest held proposals → delivered.
//      → after rollover #1: 6 delivered, 2 still held.
//   4. Period rolls over again. Release runs again.
//      → after rollover #2: 8 delivered, 0 held (queue drained).
//
// Notes:
//   • This is an in-memory integration test that exercises the real
//     `ProposalsService` code (sendProposal + releaseHeldProposalsOnPeriodReset)
//     against a stateful tx simulator. No real Postgres is required.
//   • The simulator faithfully implements the cap-respecting upsert for
//     `usage_counters` and FIFO ordering for `inbound_proposals`, which are
//     the only DB semantics this test depends on.
//
// Requirements: 5.1, 5.2, 5.7, 5.8

import { ProposalsService } from '../../src/modules/proposals/proposals.service';
import { inboundProposals } from '../../src/database/schema/inbound_proposals.schema';
import { usageCounters } from '../../src/database/schema/usage_counters.schema';
import { outbox } from '../../src/database/schema/outbox.schema';

// ── Fixtures ──────────────────────────────────────────────────────────────

const CREATOR_USER_ID = 'creator-1';
const BRAND_USER_ID = 'brand-1';
const GROWTH_INBOUND_CAP = 3;

interface Proposal {
  id: string;
  creatorUserId: string;
  brandUserId: string;
  brandName: string;
  budgetRange: string | null;
  deliverables: string | null;
  message: string | null;
  status: 'delivered' | 'held_for_upgrade' | 'auto_declined' | 'declined' | 'withdrawn';
  heldAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface HarnessState {
  tier: 'creator' | 'growth' | 'studio';
  periodStart: Date;
  periodEnd: Date;
  counter: number;
  proposals: Proposal[];
  outboxRows: Array<{ type: string; payload: Record<string, unknown>; idempotencyKey: string }>;
}

// ── In-memory tx simulator ────────────────────────────────────────────────
//
// Implements the subset of Drizzle tx behaviour exercised by:
//   • ProposalsService.sendProposal
//   • ProposalsService.releaseHeldProposalsOnPeriodReset
//   • NotificationsService.scheduleInTx (outbox insert)
//
// Drizzle SQL expression objects passed to .where() are intentionally NOT
// interpreted — the test uses a single user/period so there's no ambiguity
// about which row a given operation targets.

function buildHarness(initial: Partial<HarnessState> & { tier: HarnessState['tier'] }): {
  state: HarnessState;
  db: { transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
} {
  const periodStart = initial.periodStart ?? new Date('2024-01-01T00:00:00Z');
  const state: HarnessState = {
    tier: initial.tier,
    periodStart,
    periodEnd: initial.periodEnd ?? new Date(periodStart.getTime() + 30 * 86_400_000),
    counter: initial.counter ?? 0,
    proposals: initial.proposals ?? [],
    outboxRows: initial.outboxRows ?? [],
  };

  let proposalSeq = state.proposals.length;
  let creationSeq = state.proposals.length;

  function capForTier(): number {
    switch (state.tier) {
      case 'creator': return 0;
      case 'growth':  return GROWTH_INBOUND_CAP;
      case 'studio':  return -1;
    }
  }

  const tx = {
    query: {
      subscriptions: {
        findFirst: async () => ({
          id: 'sub-1',
          userId: CREATOR_USER_ID,
          tier: state.tier,
          status: 'active' as const,
          currentPeriodStart: state.periodStart,
          currentPeriodEnd: state.periodEnd,
          locale: 'IN' as const,
        }),
      },
      usageCounters: {
        // ProposalsService passes a callback that uses { and, eq } — we
        // ignore the predicate since there's only one (user, feature, period).
        findFirst: async (_args?: any) =>
          state.counter > 0
            ? {
                userId: CREATOR_USER_ID,
                feature: 'inbound_proposal',
                periodStart: state.periodStart,
                value: state.counter,
              }
            : null,
      },
    },

    insert(table: any) {
      // ── inbound_proposals insert ────────────────────────────────────
      if (table === inboundProposals) {
        return {
          values: (vals: any) => {
            const ts = new Date(state.periodStart.getTime() + creationSeq++ * 1000);
            const row: Proposal = {
              id: `p-${++proposalSeq}`,
              creatorUserId: vals.creatorUserId,
              brandUserId: vals.brandUserId,
              brandName: vals.brandName,
              budgetRange: vals.budgetRange ?? null,
              deliverables: vals.deliverables ?? null,
              message: vals.message ?? null,
              status: vals.status ?? 'delivered',
              heldAt: vals.heldAt ?? null,
              createdAt: ts,
              updatedAt: ts,
            };
            state.proposals.push(row);
            return { returning: async () => [row] };
          },
        };
      }

      // ── usage_counters upsert (cap-respecting) ──────────────────────
      if (table === usageCounters) {
        return {
          values: (_vals: any) => ({
            onConflictDoUpdate: async (_cfg: any) => {
              const cap = capForTier();
              if (cap === -1 || state.counter < cap) {
                state.counter++;
              }
              // No `.returning()` is awaited by ProposalsService.incrementInboundCounter.
              return undefined;
            },
          }),
        };
      }

      // ── outbox insert (NotificationsService.scheduleInTx) ───────────
      if (table === outbox) {
        return {
          values: (vals: any) => ({
            onConflictDoNothing: async () => {
              if (!state.outboxRows.find((o) => o.idempotencyKey === vals.idempotencyKey)) {
                state.outboxRows.push({
                  type: vals.type,
                  payload: vals.payload,
                  idempotencyKey: vals.idempotencyKey,
                });
              }
              return undefined;
            },
          }),
        };
      }

      throw new Error(`Unhandled insert target: ${String(table)}`);
    },

    // ── select for held-queue read (releaseHeldProposalsOnPeriodReset) ──
    select() {
      return {
        from: (table: any) => {
          if (table !== inboundProposals) {
            throw new Error('Only inbound_proposals select is supported in this harness');
          }
          return {
            where: (_w: any) => ({
              orderBy: (_o: any) => ({
                limit: async (n: number) =>
                  state.proposals
                    .filter((p) => p.status === 'held_for_upgrade')
                    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                    .slice(0, n),
              }),
            }),
          };
        },
      };
    },

    // ── update inbound_proposals (release one held → delivered) ─────────
    //
    // The release loop emits one update per row in select order, so we mark
    // the oldest held proposal as delivered each call. This matches the
    // semantics of `where(eq(inboundProposals.id, proposal.id))` without
    // having to inspect Drizzle's SQL AST.
    update(table: any) {
      if (table !== inboundProposals) {
        throw new Error('Only inbound_proposals update is supported in this harness');
      }
      return {
        set: (vals: any) => ({
          where: async (_w: any) => {
            const held = state.proposals
              .filter((p) => p.status === 'held_for_upgrade')
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            if (held.length > 0) {
              Object.assign(held[0], vals);
            }
            return undefined;
          },
        }),
      };
    },
  };

  const db = {
    transaction: async (fn: (tx: any) => Promise<any>) => fn(tx),
  };

  return { state, db };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a notifications stub that captures `scheduleInTx` calls into the
 * shared `outboxRows` array on the harness state. This mirrors the real
 * `NotificationsService.scheduleInTx`, which inserts an outbox row into the
 * caller's transaction.
 */
function buildNotificationsStub(state: HarnessState) {
  return {
    scheduleInTx: jest.fn(async (_tx: any, params: any) => {
      if (!state.outboxRows.find((o) => o.idempotencyKey === params.idempotencyKey)) {
        state.outboxRows.push({
          type: params.type,
          payload: params.payload,
          idempotencyKey: params.idempotencyKey,
        });
      }
    }),
  } as any;
}

function makeProposalParams(idx: number) {
  return {
    brandUserId: BRAND_USER_ID,
    creatorUserId: CREATOR_USER_ID,
    brandName: `Brand ${idx}`,
    budgetRange: '₹10,000 – ₹50,000',
    deliverables: '2 Reels',
    message: `Proposal #${idx}`,
  };
}

/**
 * Simulate a period rollover: counter is reset to 0 and the period window
 * advances by 30 days. This mirrors the atomic reset in
 * `PeriodAdvanceScheduler.applyRenewal` (Req 4.2).
 */
function rolloverPeriod(state: HarnessState) {
  state.counter = 0;
  state.periodStart = new Date(state.periodEnd.getTime());
  state.periodEnd = new Date(state.periodStart.getTime() + 30 * 86_400_000);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Held proposal queue — overflow and period release (integration)', () => {
  describe('Growth tier with N > cap proposals', () => {
    it(
      'caps deliveries at 3, queues overflow as held_for_upgrade, releases 3 oldest per period rollover until queue drains',
      async () => {
        // ── Setup ────────────────────────────────────────────────────
        const { state, db } = buildHarness({ tier: 'growth' });
        const notifications = buildNotificationsStub(state);
        const service = new ProposalsService(db, {} as any, notifications);

        // ── Send 8 proposals into a growth-tier creator at counter=0 ─
        // First 3 should be delivered (counter 0→1→2→3).
        // Next 5 should overflow into held_for_upgrade (counter stays 3).
        const N = 8;
        const results: Array<{ status: 'delivered' | 'held_for_upgrade' }> = [];
        for (let i = 1; i <= N; i++) {
          const r = await service.sendProposal(makeProposalParams(i));
          results.push({ status: r.status });
        }

        // ── Assert delivery / held split ─────────────────────────────
        expect(results.slice(0, 3).every((r) => r.status === 'delivered')).toBe(true);
        expect(results.slice(3).every((r) => r.status === 'held_for_upgrade')).toBe(true);

        const delivered = state.proposals.filter((p) => p.status === 'delivered');
        const held = state.proposals.filter((p) => p.status === 'held_for_upgrade');
        expect(delivered).toHaveLength(GROWTH_INBOUND_CAP); // 3
        expect(held).toHaveLength(N - GROWTH_INBOUND_CAP);  // 5

        // Counter parked at the cap — overflow attempts did not increment.
        expect(state.counter).toBe(GROWTH_INBOUND_CAP);

        // Held proposals carry a heldAt timestamp.
        for (const p of held) {
          expect(p.heldAt).toBeInstanceOf(Date);
        }

        // Each delivered proposal triggered a `proposal_received` notification,
        // each held proposal triggered a `proposal_held_upgrade_prompt`.
        const receivedNotifs = state.outboxRows.filter(
          (o) => o.payload.type === 'proposal_received',
        );
        const heldNotifs = state.outboxRows.filter(
          (o) => o.payload.type === 'proposal_held_upgrade_prompt',
        );
        expect(receivedNotifs).toHaveLength(GROWTH_INBOUND_CAP);
        expect(heldNotifs).toHaveLength(N - GROWTH_INBOUND_CAP);

        // ── Period rollover #1 ───────────────────────────────────────
        // Mirrors PeriodAdvanceScheduler.applyRenewal: counters reset,
        // then up to 3 oldest held proposals are released (Req 5.8).
        rolloverPeriod(state);
        await db.transaction((tx) => service.releaseHeldProposalsOnPeriodReset(tx, CREATOR_USER_ID));

        // Top-of-queue (FIFO) gets released first.
        const afterFirstRollover = state.proposals;
        const deliveredAfter1 = afterFirstRollover.filter((p) => p.status === 'delivered');
        const heldAfter1 = afterFirstRollover.filter((p) => p.status === 'held_for_upgrade');

        expect(deliveredAfter1).toHaveLength(GROWTH_INBOUND_CAP * 2); // 6
        expect(heldAfter1).toHaveLength(N - GROWTH_INBOUND_CAP * 2);  // 2

        // The two newest of the originally-held five are still held.
        const originallyHeldByAge = held; // captured before rollover
        const stillHeldIds = new Set(heldAfter1.map((p) => p.id));
        // The two with the *latest* createdAt remain held.
        const expectedStillHeld = [...originallyHeldByAge]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 2)
          .map((p) => p.id);
        for (const id of expectedStillHeld) {
          expect(stillHeldIds.has(id)).toBe(true);
        }

        // Each released proposal emitted a `proposal_released` notification.
        const releasedNotifs1 = state.outboxRows.filter(
          (o) => o.payload.type === 'proposal_released',
        );
        expect(releasedNotifs1).toHaveLength(GROWTH_INBOUND_CAP); // 3

        // ── Period rollover #2 — drains the remaining queue ──────────
        rolloverPeriod(state);
        await db.transaction((tx) => service.releaseHeldProposalsOnPeriodReset(tx, CREATOR_USER_ID));

        const deliveredAfter2 = state.proposals.filter((p) => p.status === 'delivered');
        const heldAfter2 = state.proposals.filter((p) => p.status === 'held_for_upgrade');
        expect(deliveredAfter2).toHaveLength(N); // 8
        expect(heldAfter2).toHaveLength(0);

        const releasedNotifs2 = state.outboxRows.filter(
          (o) => o.payload.type === 'proposal_released',
        );
        expect(releasedNotifs2).toHaveLength(N - GROWTH_INBOUND_CAP); // 5 total released over 2 rollovers
      },
    );

    it('does NOT increment usage counter when proposals are held over cap', async () => {
      const { state, db } = buildHarness({ tier: 'growth' });
      const service = new ProposalsService(db, {} as any, buildNotificationsStub(state));

      // Send 6 proposals (3 delivered, 3 held).
      for (let i = 1; i <= 6; i++) {
        await service.sendProposal(makeProposalParams(i));
      }

      // Counter must be parked at the cap — none of the held proposals
      // contributed to it. (Req 5.2)
      expect(state.counter).toBe(GROWTH_INBOUND_CAP);
    });

    it('release runs against an empty held queue without side-effects', async () => {
      const { state, db } = buildHarness({ tier: 'growth' });
      const service = new ProposalsService(db, {} as any, buildNotificationsStub(state));

      // Counter still at zero; period rollover happens with nothing held.
      rolloverPeriod(state);
      const released = await db.transaction((tx) =>
        service.releaseHeldProposalsOnPeriodReset(tx, CREATOR_USER_ID),
      );

      expect(released).toBe(0);
      expect(state.outboxRows.filter((o) => o.payload.type === 'proposal_released')).toHaveLength(0);
    });
  });
});
