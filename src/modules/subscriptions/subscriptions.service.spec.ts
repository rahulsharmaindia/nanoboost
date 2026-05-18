// ── SubscriptionsService unit tests ─────────────────────────────────────
//
// Covers the state machine for SubscriptionsService:
//   - createForNewUser (idempotent: calling twice returns the same row)
//   - upgrade (free→paid resets counters & period; paid→paid prorated, no
//     reset; rejects same/lower-tier targets; surfaces PaymentFailedError)
//   - scheduleDowngrade (sets pendingTier; rejects equal/higher tier and
//     duplicate pending_tier)
//   - cancel (sets status=canceling; idempotent on already-canceling;
//     SubscriptionNotFound when missing)
//   - resume (clears canceling → active; rejects from non-canceling status)
//
// The Drizzle client and PaymentPort are mocked. MoneyMathService is used
// real because it's pure arithmetic. Audit-event and notification
// collaborators are recorded through jest mocks so we can assert ordering
// and payloads.
//
// Task: 23.9
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 7.1, 7.2, 7.5, 7.7, 7.8, 8.1,
//               8.3, 8.8, 17.5, 17.6, 22.5, 24.1

import { SubscriptionsService } from './subscriptions.service';
import { MoneyMathService } from './money-math.service';
import {
  InvalidDowngradeTargetError,
  PaymentFailedError,
  SubscriptionNotFoundError,
  SubscriptionProvisioningError,
} from './subscriptions.errors';

// ── Helpers ────────────────────────────────────────────────────────────

function makeSubscription(overrides: Record<string, any> = {}): any {
  const start = new Date('2024-01-01T00:00:00Z');
  const end = new Date('2024-01-31T00:00:00Z');
  return {
    id: 'sub-1',
    userId: 'user-1',
    tier: 'creator',
    status: 'active',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    pendingTier: null,
    paymentOwed: false,
    locale: 'IN',
    createdAt: start,
    updatedAt: start,
    ...overrides,
  };
}

function makePlan(tier: 'creator' | 'growth' | 'studio', overrides: Record<string, any> = {}): any {
  const priceMap = { creator: 0, growth: 49900, studio: 149900 };
  return {
    id: `plan-${tier}-IN`,
    tier,
    locale: 'IN',
    priceMinorUnits: priceMap[tier],
    currency: 'INR',
    isMostPopular: tier === 'growth',
    analyticsWindowDays: 30,
    applicationCapMonthly: tier === 'creator' ? 0 : tier === 'growth' ? 10 : -1,
    proposalCapMonthly: tier === 'creator' ? 0 : tier === 'growth' ? 3 : -1,
    aiToolCapMonthly: tier === 'creator' ? 0 : tier === 'growth' ? 25 : -1,
    commissionPct: tier === 'creator' ? 15 : tier === 'growth' ? 10 : 5,
    concurrentCampaignsCap: tier === 'creator' ? 0 : tier === 'growth' ? 3 : -1,
    supportLevel: 'email',
    earlyAccessHours: tier === 'studio' ? 24 : 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Build a minimal mock that supports both the direct-on-db calls used in
 * createForNewUser (insert().values().onConflictDoNothing().returning() and
 * db.query.subscriptions.findFirst) and the transactional calls used in
 * the rest of the service (db.transaction(fn) → fn(tx), tx.query.*,
 * tx.update(), tx.delete(), tx.insert()).
 */
function buildMockDb(opts: {
  /** Subscription returned by tx.query.subscriptions.findFirst (or db.query for createForNewUser) */
  subscription?: any | null;
  /** Sequence of subs returned across multiple createForNewUser calls (idempotency tests) */
  subscriptionSequence?: Array<any | null>;
  /** What the initial insert in createForNewUser returns */
  insertReturning?: any[];
  /** Sequence for createForNewUser inserts across calls */
  insertReturningSequence?: Array<any[]>;
  /** Updated row returned by tx.update().returning() */
  updateReturning?: any;
} = {}) {
  let subSeqIdx = 0;
  let insertSeqIdx = 0;

  const updateCalls: Array<{ table: any; setValues: any; whereCalled: boolean }> = [];
  const deleteCalls: Array<{ table: any }> = [];
  const insertCalls: Array<{ table: any; values: any }> = [];

  const findFirstSubscription = jest.fn().mockImplementation(async () => {
    if (opts.subscriptionSequence) {
      const v = opts.subscriptionSequence[subSeqIdx] ?? null;
      subSeqIdx += 1;
      return v;
    }
    return opts.subscription === undefined ? null : opts.subscription;
  });

  const txOrDb = {
    query: {
      subscriptions: { findFirst: findFirstSubscription },
      payments: { findFirst: jest.fn().mockResolvedValue(null) },
      addOnPurchases: { findFirst: jest.fn().mockResolvedValue(null) },
    },
    update: jest.fn().mockImplementation((table: any) => ({
      set: jest.fn().mockImplementation((setValues: any) => {
        updateCalls.push({ table, setValues, whereCalled: false });
        const last = updateCalls[updateCalls.length - 1];
        return {
          where: jest.fn().mockImplementation(() => {
            last.whereCalled = true;
            const updated = opts.updateReturning ?? {
              ...(opts.subscription ?? {}),
              ...setValues,
            };
            return {
              returning: jest.fn().mockResolvedValue([updated]),
            };
          }),
        };
      }),
    })),
    delete: jest.fn().mockImplementation((table: any) => {
      deleteCalls.push({ table });
      return {
        where: jest.fn().mockResolvedValue(undefined),
      };
    }),
    insert: jest.fn().mockImplementation((table: any) => ({
      values: jest.fn().mockImplementation((vals: any) => {
        insertCalls.push({ table, values: vals });
        return {
          // Path used by createForNewUser
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockImplementation(async () => {
              if (opts.insertReturningSequence) {
                const v = opts.insertReturningSequence[insertSeqIdx] ?? [];
                insertSeqIdx += 1;
                return v;
              }
              return opts.insertReturning ?? [];
            }),
          }),
          // Path that would be used by anything plain
          returning: jest.fn().mockResolvedValue([vals]),
        };
      }),
    })),
  };

  const db: any = {
    ...txOrDb,
    transaction: jest.fn().mockImplementation(async (fn: (tx: any) => any) => fn(txOrDb)),
  };

  return { db, tx: txOrDb, updateCalls, deleteCalls, insertCalls };
}

function buildService(opts: {
  db: any;
  paymentResult?: { success: boolean; providerRef?: string; error?: string };
  oldPlanTier?: 'creator' | 'growth' | 'studio';
  newPlanTier?: 'creator' | 'growth' | 'studio';
}) {
  const subscriptionsRepository: any = {};
  const subscriptionEventsRepository: any = {
    append: jest.fn().mockResolvedValue(undefined),
  };
  const moneyMathService = new MoneyMathService();
  const paymentPort: any = {
    charge: jest.fn().mockResolvedValue(opts.paymentResult ?? { success: true, providerRef: 'pp-1' }),
    createMandate: jest.fn(),
    cancelMandate: jest.fn(),
    parseWebhook: jest.fn(),
  };
  const plansCatalogService: any = {
    getPlan: jest.fn().mockImplementation(async (tier: any) => ({
      plan: makePlan(tier),
      fallbackUsed: false,
    })),
  };
  const notificationsService: any = {
    scheduleInTx: jest.fn().mockResolvedValue(undefined),
  };

  const service = new SubscriptionsService(
    subscriptionsRepository,
    subscriptionEventsRepository,
    moneyMathService,
    paymentPort,
    plansCatalogService,
    opts.db,
    notificationsService,
  );

  return {
    service,
    subscriptionEventsRepository,
    paymentPort,
    plansCatalogService,
    notificationsService,
    moneyMathService,
  };
}

// ── createForNewUser ──────────────────────────────────────────────────

describe('SubscriptionsService.createForNewUser — Req 17.5/17.6/4.5', () => {
  it('inserts and returns a fresh creator-tier subscription on first call', async () => {
    const inserted = makeSubscription({ tier: 'creator', status: 'active' });
    const { db, insertCalls } = buildMockDb({ insertReturning: [inserted] });
    const { service } = buildService({ db });

    const result = await service.createForNewUser('user-1', 'IN');

    expect(result).toEqual(inserted);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].values).toMatchObject({
      userId: 'user-1',
      tier: 'creator',
      status: 'active',
      locale: 'IN',
    });
    // Period must be 30 days
    const ms = (insertCalls[0].values.currentPeriodEnd as Date).getTime()
      - (insertCalls[0].values.currentPeriodStart as Date).getTime();
    expect(ms).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('is idempotent: second call returns the same existing row without re-inserting', async () => {
    const existing = makeSubscription({ tier: 'creator' });
    // First call inserts, second call finds existing.
    const { db } = buildMockDb({
      insertReturningSequence: [[existing], []], // first returns inserted; second insert is a no-op
      subscriptionSequence: [existing], // findFirst on the second call returns existing
    });
    const { service } = buildService({ db });

    const first = await service.createForNewUser('user-1', 'IN');
    const second = await service.createForNewUser('user-1', 'IN');

    expect(first).toEqual(existing);
    expect(second).toEqual(existing);
    // Both calls must have produced identical row identity
    expect(second.id).toBe(first.id);
    expect(second.userId).toBe(first.userId);
  });

  it('throws SubscriptionProvisioningError when insert is a no-op AND no existing row is found', async () => {
    const { db } = buildMockDb({
      insertReturning: [],         // no-op insert
      subscription: null,          // and no existing row
    });
    const { service } = buildService({ db });

    await expect(service.createForNewUser('user-1', 'IN'))
      .rejects.toThrow(SubscriptionProvisioningError);
  });

  it('wraps unexpected DB errors in SubscriptionProvisioningError', async () => {
    const db: any = {
      insert: jest.fn().mockImplementation(() => {
        throw new Error('connection refused');
      }),
      query: { subscriptions: { findFirst: jest.fn() } },
      transaction: jest.fn(),
    };
    const { service } = buildService({ db });

    await expect(service.createForNewUser('user-1', 'IN'))
      .rejects.toThrow(SubscriptionProvisioningError);
  });

  it('defaults locale to IN when not provided', async () => {
    const { db, insertCalls } = buildMockDb({
      insertReturning: [makeSubscription()],
    });
    const { service } = buildService({ db });

    await service.createForNewUser('user-1');
    expect(insertCalls[0].values.locale).toBe('IN');
  });
});

// ── upgrade ───────────────────────────────────────────────────────────

describe('SubscriptionsService.upgrade — Req 6.1/6.2/6.3/6.4/6.6', () => {
  it('free→paid: charges full price, starts a fresh 30-day period, resets counters', async () => {
    const sub = makeSubscription({ tier: 'creator' });
    const updated = { ...sub, tier: 'growth' };
    const { db, deleteCalls, updateCalls } = buildMockDb({
      subscription: sub,
      updateReturning: updated,
    });
    const { service, paymentPort, subscriptionEventsRepository } = buildService({ db });

    const before = Date.now();
    const result = await service.upgrade('user-1', 'growth');
    const after = Date.now();

    // charge: full new-plan price
    expect(paymentPort.charge).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      amountMinor: 49900,
      currency: 'INR',
    }));

    // counter reset: a delete on usageCounters happened
    expect(deleteCalls).toHaveLength(1);

    // subscription update: tier=growth, fresh period
    expect(updateCalls).toHaveLength(1);
    const setValues = updateCalls[0].setValues;
    expect(setValues.tier).toBe('growth');
    expect(setValues.pendingTier).toBeNull();
    const start: Date = setValues.currentPeriodStart;
    const end: Date = setValues.currentPeriodEnd;
    expect(start.getTime()).toBeGreaterThanOrEqual(before);
    expect(start.getTime()).toBeLessThanOrEqual(after);
    expect(end.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);

    // audit event appended
    expect(subscriptionEventsRepository.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'tier_upgraded', actorType: 'user' }),
    );

    expect(result).toEqual(updated);
  });

  it('paid→paid: prorated charge, preserves period, does NOT reset counters', async () => {
    // Start period 10 days ago (elapsedDays = 10, remaining = 20)
    const start = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sub = makeSubscription({ tier: 'growth', currentPeriodStart: start, currentPeriodEnd: end });
    const updated = { ...sub, tier: 'studio' };
    const { db, deleteCalls, updateCalls } = buildMockDb({
      subscription: sub,
      updateReturning: updated,
    });
    const { service, paymentPort, moneyMathService } = buildService({ db });

    await service.upgrade('user-1', 'studio');

    // expected = bankerRound((149900 - 49900) * (30 - 10) / 30)
    const expected = moneyMathService.proratedUpgrade(49900, 149900, 10, 30);
    expect(paymentPort.charge).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: expected,
    }));

    // No counter reset (paid→paid keeps usage)
    expect(deleteCalls).toHaveLength(0);

    // Period not changed: setValues should preserve the original period
    const setValues = updateCalls[0].setValues;
    expect(setValues.currentPeriodStart).toBe(start);
    expect(setValues.currentPeriodEnd).toBe(end);
    expect(setValues.tier).toBe('studio');
  });

  it('rejects upgrade to same-rank or lower tier with InvalidDowngradeTargetError', async () => {
    const sub = makeSubscription({ tier: 'growth' });
    const { db } = buildMockDb({ subscription: sub });
    const { service, paymentPort } = buildService({ db });

    // Same tier
    await expect(service.upgrade('user-1', 'growth' as any))
      .rejects.toThrow(InvalidDowngradeTargetError);

    // Lower tier (studio→growth would also be a downgrade attempt)
    const sub2 = makeSubscription({ tier: 'studio' });
    const { db: db2 } = buildMockDb({ subscription: sub2 });
    const { service: svc2, paymentPort: port2 } = buildService({ db: db2 });
    await expect(svc2.upgrade('user-1', 'growth'))
      .rejects.toThrow(InvalidDowngradeTargetError);

    // No charge attempted
    expect(paymentPort.charge).not.toHaveBeenCalled();
    expect(port2.charge).not.toHaveBeenCalled();
  });

  it('throws SubscriptionNotFoundError when no subscription row exists', async () => {
    const { db } = buildMockDb({ subscription: null });
    const { service } = buildService({ db });

    await expect(service.upgrade('user-missing', 'growth'))
      .rejects.toThrow(SubscriptionNotFoundError);
  });

  it('throws PaymentFailedError when the payment provider rejects the charge', async () => {
    const sub = makeSubscription({ tier: 'creator' });
    const { db, updateCalls } = buildMockDb({ subscription: sub });
    const { service } = buildService({
      db,
      paymentResult: { success: false, error: 'card_declined' },
    });

    await expect(service.upgrade('user-1', 'growth'))
      .rejects.toThrow(PaymentFailedError);

    // No subscription update applied because the txn aborts via thrown error
    expect(updateCalls).toHaveLength(0);
  });

  it('uses an idempotency key derived from sub.id, target tier, and period start', async () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const sub = makeSubscription({ tier: 'creator', id: 'sub-xyz', currentPeriodStart: start });
    const { db } = buildMockDb({ subscription: sub });
    const { service, paymentPort } = buildService({ db });

    await service.upgrade('user-1', 'growth');

    expect(paymentPort.charge).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `upgrade:sub-xyz:growth:${start.toISOString()}`,
    }));
  });
});

// ── scheduleDowngrade ─────────────────────────────────────────────────

describe('SubscriptionsService.scheduleDowngrade — Req 7.1/7.2/7.5/7.7/7.8', () => {
  it('sets pendingTier without changing the active tier', async () => {
    const sub = makeSubscription({ tier: 'studio' });
    const updated = { ...sub, pendingTier: 'growth' };
    const { db, updateCalls } = buildMockDb({ subscription: sub, updateReturning: updated });
    const { service, subscriptionEventsRepository } = buildService({ db });

    await service.scheduleDowngrade('user-1', 'growth');

    expect(updateCalls).toHaveLength(1);
    const setValues = updateCalls[0].setValues;
    expect(setValues.pendingTier).toBe('growth');
    // active tier MUST NOT change in setValues
    expect(setValues.tier).toBeUndefined();

    expect(subscriptionEventsRepository.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'tier_downgrade_requested', actorType: 'user' }),
    );
  });

  it('rejects target with rank ≥ active tier (InvalidDowngradeTargetError)', async () => {
    // growth → studio (higher rank) — invalid downgrade
    const sub = makeSubscription({ tier: 'growth' });
    const { db, updateCalls } = buildMockDb({ subscription: sub });
    const { service } = buildService({ db });

    await expect(service.scheduleDowngrade('user-1', 'studio' as any))
      .rejects.toThrow(InvalidDowngradeTargetError);
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects target equal to active tier', async () => {
    const sub = makeSubscription({ tier: 'growth' });
    const { db } = buildMockDb({ subscription: sub });
    const { service } = buildService({ db });

    await expect(service.scheduleDowngrade('user-1', 'growth'))
      .rejects.toThrow(InvalidDowngradeTargetError);
  });

  it('rejects target equal to existing pending_tier (Req 7.2)', async () => {
    const sub = makeSubscription({ tier: 'studio', pendingTier: 'growth' });
    const { db, updateCalls } = buildMockDb({ subscription: sub });
    const { service } = buildService({ db });

    await expect(service.scheduleDowngrade('user-1', 'growth'))
      .rejects.toThrow(InvalidDowngradeTargetError);
    expect(updateCalls).toHaveLength(0);
  });

  it('throws SubscriptionNotFoundError when no subscription row exists', async () => {
    const { db } = buildMockDb({ subscription: null });
    const { service } = buildService({ db });

    await expect(service.scheduleDowngrade('user-missing', 'creator'))
      .rejects.toThrow(SubscriptionNotFoundError);
  });
});

// ── cancel ────────────────────────────────────────────────────────────

describe('SubscriptionsService.cancel — Req 8.1/8.8', () => {
  it('sets status to canceling without changing tier or counters', async () => {
    const sub = makeSubscription({ tier: 'growth', status: 'active' });
    const updated = { ...sub, status: 'canceling' };
    const { db, updateCalls, deleteCalls } = buildMockDb({
      subscription: sub,
      updateReturning: updated,
    });
    const { service, subscriptionEventsRepository } = buildService({ db });

    await service.cancel('user-1');

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].setValues.status).toBe('canceling');
    // tier unchanged (not present in setValues)
    expect(updateCalls[0].setValues.tier).toBeUndefined();
    // counters NOT reset on cancel-request
    expect(deleteCalls).toHaveLength(0);

    expect(subscriptionEventsRepository.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'cancellation_requested',
        actorType: 'user',
      }),
    );
  });

  it('is a no-op when subscription is already canceling (idempotent)', async () => {
    const sub = makeSubscription({ tier: 'growth', status: 'canceling' });
    const { db, updateCalls } = buildMockDb({ subscription: sub });
    const { service, subscriptionEventsRepository } = buildService({ db });

    await service.cancel('user-1');

    expect(updateCalls).toHaveLength(0);
    expect(subscriptionEventsRepository.append).not.toHaveBeenCalled();
  });

  it('throws SubscriptionNotFoundError when no subscription row exists', async () => {
    const { db } = buildMockDb({ subscription: null });
    const { service } = buildService({ db });

    await expect(service.cancel('user-missing'))
      .rejects.toThrow(SubscriptionNotFoundError);
  });
});

// ── resume ────────────────────────────────────────────────────────────

describe('SubscriptionsService.resume — Req 8.3/8.8', () => {
  it('reverts canceling → active and retains period & counters', async () => {
    const sub = makeSubscription({ tier: 'growth', status: 'canceling' });
    const updated = { ...sub, status: 'active' };
    const { db, updateCalls, deleteCalls } = buildMockDb({
      subscription: sub,
      updateReturning: updated,
    });
    const { service, subscriptionEventsRepository } = buildService({ db });

    await service.resume('user-1');

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].setValues.status).toBe('active');
    // Period and tier untouched in setValues
    expect(updateCalls[0].setValues.tier).toBeUndefined();
    expect(updateCalls[0].setValues.currentPeriodEnd).toBeUndefined();
    // No counter reset
    expect(deleteCalls).toHaveLength(0);

    expect(subscriptionEventsRepository.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'cancellation_resumed',
        actorType: 'user',
      }),
    );
  });

  it('rejects resume from non-canceling status (active)', async () => {
    const sub = makeSubscription({ tier: 'growth', status: 'active' });
    const { db, updateCalls } = buildMockDb({ subscription: sub });
    const { service, subscriptionEventsRepository } = buildService({ db });

    await expect(service.resume('user-1'))
      .rejects.toThrow(InvalidDowngradeTargetError);
    expect(updateCalls).toHaveLength(0);
    expect(subscriptionEventsRepository.append).not.toHaveBeenCalled();
  });

  it('rejects resume from non-canceling status (payment_failed)', async () => {
    const sub = makeSubscription({ tier: 'growth', status: 'payment_failed' });
    const { db } = buildMockDb({ subscription: sub });
    const { service } = buildService({ db });

    await expect(service.resume('user-1'))
      .rejects.toThrow(InvalidDowngradeTargetError);
  });

  it('throws SubscriptionNotFoundError when no subscription row exists', async () => {
    const { db } = buildMockDb({ subscription: null });
    const { service } = buildService({ db });

    await expect(service.resume('user-missing'))
      .rejects.toThrow(SubscriptionNotFoundError);
  });
});

// ── Cancellation wins over pending downgrade (cross-cutting Req 7.6) ───

describe('SubscriptionsService.cancel — interaction with pending_tier (Req 7.6)', () => {
  it('cancellation transitions a sub with pending_tier into canceling status', async () => {
    // Even when a downgrade is pending, cancel() flips status to canceling.
    // The scheduler is responsible for clearing pending_tier at period end;
    // the service-level cancel only sets status.
    const sub = makeSubscription({
      tier: 'studio',
      status: 'active',
      pendingTier: 'growth',
    });
    const updated = { ...sub, status: 'canceling' };
    const { db, updateCalls } = buildMockDb({
      subscription: sub,
      updateReturning: updated,
    });
    const { service } = buildService({ db });

    await service.cancel('user-1');

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].setValues.status).toBe('canceling');
  });
});
