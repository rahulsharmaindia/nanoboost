// ── ProposalsService unit tests ───────────────────────────────────────────
//
// Tests the inbound proposal dispatch logic:
//   - creator tier → TierLockedError
//   - growth tier, counter < 3 → delivered + counter incremented
//   - growth tier, counter >= 3 → held_for_upgrade, counter NOT incremented
//   - studio tier (unlimited) → delivered + counter incremented
//
// Uses an in-memory mock for the DB transaction to avoid needing a real
// Postgres instance.
//
// Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.10

import { TierLockedError, SubscriptionNotFoundError } from '../subscriptions/subscriptions.errors';
import { ProposalsService } from './proposals.service';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeSubscription(tier: 'creator' | 'growth' | 'studio') {
  return {
    userId: 'creator-1',
    tier,
    currentPeriodStart: new Date('2024-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2024-01-31T00:00:00Z'),
  };
}

function makeParams(overrides: Partial<{
  brandUserId: string;
  creatorUserId: string;
  brandName: string;
  budgetRange: string;
  deliverables: string;
  message: string;
}> = {}) {
  return {
    brandUserId: 'brand-1',
    creatorUserId: 'creator-1',
    brandName: 'Acme Corp',
    budgetRange: '₹10,000 – ₹50,000',
    deliverables: '2 Reels',
    message: 'We love your content!',
    ...overrides,
  };
}

// ── Mock factory ──────────────────────────────────────────────────────────

/**
 * Build a minimal mock DB that simulates the transaction + query behaviour
 * needed by ProposalsService.sendProposal.
 *
 * @param tier - creator's subscription tier
 * @param currentCounter - current inbound_proposal counter value (0 if no row)
 */
function buildMockDb(
  tier: 'creator' | 'growth' | 'studio',
  currentCounter: number,
) {
  const insertedProposals: any[] = [];
  const counterUpdates: any[] = [];
  const notificationInserts: any[] = [];

  const sub = makeSubscription(tier);

  const tx = {
    query: {
      subscriptions: {
        findFirst: jest.fn().mockResolvedValue(sub),
      },
      usageCounters: {
        findFirst: jest.fn().mockResolvedValue(
          currentCounter > 0 ? { value: currentCounter } : null,
        ),
      },
    },
    insert: jest.fn().mockImplementation((table: any) => {
      if (table === require('../../database/schema/inbound_proposals.schema').inboundProposals) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{
              id: 'proposal-1',
              creatorUserId: 'creator-1',
              brandUserId: 'brand-1',
              brandName: 'Acme Corp',
              status: 'delivered',
              createdAt: new Date(),
              updatedAt: new Date(),
            }]),
          }),
        };
      }
      // usageCounters insert
      return {
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockReturnValue({
            // simulate successful increment
            returning: jest.fn().mockResolvedValue([{ value: currentCounter + 1 }]),
          }),
        }),
      };
    }),
  };

  const db = {
    transaction: jest.fn().mockImplementation(async (fn: (tx: any) => any) => fn(tx)),
  };

  return { db, tx, insertedProposals, counterUpdates, notificationInserts };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ProposalsService.sendProposal', () => {
  let notificationsService: any;

  beforeEach(() => {
    notificationsService = {
      scheduleInTx: jest.fn().mockResolvedValue(undefined),
    };
  });

  // ── creator tier ────────────────────────────────────────────────────────

  it('throws TierLockedError when creator tier (cap = 0)', async () => {
    const { db } = buildMockDb('creator', 0);
    const service = new ProposalsService(db, {} as any, notificationsService);

    await expect(service.sendProposal(makeParams())).rejects.toThrow(TierLockedError);
  });

  it('TierLockedError has correct feature and tier fields', async () => {
    const { db } = buildMockDb('creator', 0);
    const service = new ProposalsService(db, {} as any, notificationsService);

    try {
      await service.sendProposal(makeParams());
      fail('Expected TierLockedError');
    } catch (err) {
      expect(err).toBeInstanceOf(TierLockedError);
      const e = err as TierLockedError;
      expect(e.feature).toBe('inbound_proposal');
      expect(e.currentTier).toBe('creator');
      expect(e.suggestedTier).toBe('growth');
    }
  });

  // ── growth tier, under cap ──────────────────────────────────────────────

  it('delivers proposal when growth tier and counter < 3', async () => {
    const { db } = buildMockDb('growth', 0);
    const service = new ProposalsService(db, {} as any, notificationsService);

    const result = await service.sendProposal(makeParams());

    expect(result.status).toBe('delivered');
    expect(result.proposal).toBeDefined();
  });

  it('delivers proposal when growth tier and counter = 2 (last slot)', async () => {
    const { db } = buildMockDb('growth', 2);
    const service = new ProposalsService(db, {} as any, notificationsService);

    const result = await service.sendProposal(makeParams());

    expect(result.status).toBe('delivered');
  });

  it('schedules proposal_received notification when delivered', async () => {
    const { db } = buildMockDb('growth', 0);
    const service = new ProposalsService(db, {} as any, notificationsService);

    await service.sendProposal(makeParams());

    expect(notificationsService.scheduleInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'in_app',
        payload: expect.objectContaining({ type: 'proposal_received' }),
      }),
    );
  });

  // ── growth tier, at cap ─────────────────────────────────────────────────

  it('holds proposal when growth tier and counter = 3 (at cap)', async () => {
    const { db, tx } = buildMockDb('growth', 3);

    // Override insert to capture the status passed to inbound_proposals
    let capturedStatus: string | undefined;
    const inboundProposalsTable = require('../../database/schema/inbound_proposals.schema').inboundProposals;
    tx.insert = jest.fn().mockImplementation((table: any) => {
      if (table === inboundProposalsTable) {
        return {
          values: jest.fn().mockImplementation((vals: any) => {
            capturedStatus = vals.status;
            return {
              returning: jest.fn().mockResolvedValue([{
                id: 'proposal-1',
                creatorUserId: 'creator-1',
                brandUserId: 'brand-1',
                brandName: 'Acme Corp',
                status: vals.status,
                createdAt: new Date(),
                updatedAt: new Date(),
              }]),
            };
          }),
        };
      }
      return {
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ value: 4 }]),
          }),
        }),
      };
    });

    const service = new ProposalsService(db, {} as any, notificationsService);
    const result = await service.sendProposal(makeParams());

    expect(result.status).toBe('held_for_upgrade');
    expect(capturedStatus).toBe('held_for_upgrade');
  });

  it('does NOT increment counter when proposal is held', async () => {
    const { db, tx } = buildMockDb('growth', 3);

    const inboundProposalsTable = require('../../database/schema/inbound_proposals.schema').inboundProposals;
    const usageCountersTable = require('../../database/schema/usage_counters.schema').usageCounters;

    let usageCounterInsertCalled = false;
    tx.insert = jest.fn().mockImplementation((table: any) => {
      if (table === inboundProposalsTable) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{
              id: 'proposal-1',
              creatorUserId: 'creator-1',
              brandUserId: 'brand-1',
              brandName: 'Acme Corp',
              status: 'held_for_upgrade',
              createdAt: new Date(),
              updatedAt: new Date(),
            }]),
          }),
        };
      }
      if (table === usageCountersTable) {
        usageCounterInsertCalled = true;
      }
      return {
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      };
    });

    const service = new ProposalsService(db, {} as any, notificationsService);
    await service.sendProposal(makeParams());

    expect(usageCounterInsertCalled).toBe(false);
  });

  it('schedules upgrade prompt notification when held', async () => {
    const { db, tx } = buildMockDb('growth', 3);

    const inboundProposalsTable = require('../../database/schema/inbound_proposals.schema').inboundProposals;
    tx.insert = jest.fn().mockImplementation((table: any) => {
      if (table === inboundProposalsTable) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{
              id: 'proposal-1',
              creatorUserId: 'creator-1',
              brandUserId: 'brand-1',
              brandName: 'Acme Corp',
              status: 'held_for_upgrade',
              createdAt: new Date(),
              updatedAt: new Date(),
            }]),
          }),
        };
      }
      return {
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      };
    });

    const service = new ProposalsService(db, {} as any, notificationsService);
    await service.sendProposal(makeParams());

    expect(notificationsService.scheduleInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'in_app',
        payload: expect.objectContaining({ type: 'proposal_held_upgrade_prompt' }),
      }),
    );
  });

  // ── studio tier (unlimited) ─────────────────────────────────────────────

  it('delivers proposal when studio tier (unlimited)', async () => {
    const { db } = buildMockDb('studio', 0);
    const service = new ProposalsService(db, {} as any, notificationsService);

    const result = await service.sendProposal(makeParams());

    expect(result.status).toBe('delivered');
  });

  it('increments counter when studio tier delivers', async () => {
    const { db, tx } = buildMockDb('studio', 5);

    const inboundProposalsTable = require('../../database/schema/inbound_proposals.schema').inboundProposals;
    const usageCountersTable = require('../../database/schema/usage_counters.schema').usageCounters;

    let usageCounterInsertCalled = false;
    tx.insert = jest.fn().mockImplementation((table: any) => {
      if (table === inboundProposalsTable) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{
              id: 'proposal-1',
              creatorUserId: 'creator-1',
              brandUserId: 'brand-1',
              brandName: 'Acme Corp',
              status: 'delivered',
              createdAt: new Date(),
              updatedAt: new Date(),
            }]),
          }),
        };
      }
      if (table === usageCountersTable) {
        usageCounterInsertCalled = true;
      }
      return {
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ value: 6 }]),
          }),
        }),
      };
    });

    const service = new ProposalsService(db, {} as any, notificationsService);
    await service.sendProposal(makeParams());

    expect(usageCounterInsertCalled).toBe(true);
  });

  // ── missing subscription ────────────────────────────────────────────────

  it('throws SubscriptionNotFoundError when creator has no subscription', async () => {
    const db = {
      transaction: jest.fn().mockImplementation(async (fn: (tx: any) => any) =>
        fn({
          query: {
            subscriptions: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          },
        }),
      ),
    };

    const service = new ProposalsService(db, {} as any, notificationsService);

    await expect(service.sendProposal(makeParams())).rejects.toThrow(SubscriptionNotFoundError);
  });
});
