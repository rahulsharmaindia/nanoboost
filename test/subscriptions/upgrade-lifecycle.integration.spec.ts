// ── Integration test: free → growth → studio upgrade lifecycle ──────────
//
// Task 23.1 — Validates the end-to-end behaviour of the subscription
// upgrade ladder for a brand-new creator across two consecutive upgrades:
//
//   1. Sign-up provisions a free 'creator' subscription via
//      `subscriptionsService.createForNewUser` with a fresh 30-day period.
//
//   2. Upgrade creator → growth (free → paid).
//      Asserts (Req 6.1, 6.2, 6.5):
//        - tier changes to 'growth'
//        - status remains 'active'
//        - PaymentPort.charge invoked with the FULL growth price
//        - a fresh 30-day period (currentPeriodStart shifts to upgrade time)
//        - all usage counters reset to 0 (the seeded 'creator'-period rows
//          are deleted)
//        - tier_upgraded audit event appended in the same transaction
//
//   3. Upgrade growth → studio mid-period (paid → paid).
//      Asserts (Req 6.3, 6.4, 6.6, 6.7, 22.5):
//        - tier changes to 'studio'
//        - PaymentPort.charge invoked with a PRORATED delta exactly equal
//          to bankerRound((p2 − p1) × (30 − d) / 30)
//        - the prorated charge is strictly less than the full price
//          difference (since d > 0)
//        - currentPeriodStart and currentPeriodEnd are preserved
//          (anniversary not shifted)
//        - usage counters seeded mid-period are preserved (not reset)
//        - tier_upgraded audit event appended again
//
// Wiring:
//   - Real SubscriptionsService, SubscriptionEventsRepository, MoneyMathService.
//   - In-memory stateful mock DB models the rows + transactions used by
//     SubscriptionsService.createForNewUser, .upgrade, the events repository,
//     and NotificationsService.scheduleReceipt.
//   - Mock PaymentPort (similar to MockPaymentAdapter — always succeeds and
//     records every charge for inspection).
//   - Mock NotificationPort capturing email/in-app dispatches.
//   - PlansCatalogService stubbed to return the canonical IN-locale rows from
//     the plans seed (creator: 0, growth: 49900, studio: 149900).
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 22.5

import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { SubscriptionEventsRepository } from '../../src/modules/subscriptions/subscription-events.repository';
import { MoneyMathService } from '../../src/modules/subscriptions/money-math.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { subscriptions as subsTable } from '../../src/database/schema/subscriptions.schema';
import { usageCounters as usageTable } from '../../src/database/schema/usage_counters.schema';
import { subscriptionEvents as eventsTable } from '../../src/database/schema/subscription_events.schema';
import { outbox as outboxTable } from '../../src/database/schema/outbox.schema';

// ── Test fixtures ─────────────────────────────────────────────────────────

const USER_ID = 'creator-upgrade-1';
const LOCALE: 'IN' | 'US' = 'IN';

// Canonical IN-locale prices from the plans seed (server/src/database/seed/plans.seed.ts):
//   creator → 0
//   growth  → 49 900 (₹499.00)
//   studio  → 149 900 (₹1 499.00)
const PRICE_CREATOR = 0;
const PRICE_GROWTH = 49_900;
const PRICE_STUDIO = 149_900;

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Mock DB factory ───────────────────────────────────────────────────────
//
// In-memory simulator covering:
//   • db.insert(subsTable).values(…).onConflictDoNothing().returning()
//       — used by SubscriptionsService.createForNewUser
//   • db.query.subscriptions.findFirst()
//       — used by SubscriptionsService.createForNewUser
//   • db.transaction(fn)
//       — used by SubscriptionsService.upgrade
//   • Within the tx:
//       - tx.query.subscriptions.findFirst
//       - tx.update(subsTable).set(vals).where(…).returning()
//       - tx.delete(usageTable).where(…)
//       - tx.insert(eventsTable).values(vals)         (events repo)
//       - tx.insert(outboxTable).values(vals).onConflictDoNothing()  (outbox)
//   • db.insert(outboxTable) at the top level — used by
//       NotificationsService.scheduleReceipt.

interface MockState {
  subscription: any | null;          // single-row table (uniq on user_id)
  usageCounterRows: any[];
  events: any[];
  outboxRows: any[];
}

function buildMockDb(state: MockState) {
  let subSeq = 0;
  let evtSeq = 0;
  let outboxSeq = 0;

  function applyUpdate(table: any, vals: Record<string, unknown>) {
    if (table === subsTable && state.subscription) {
      Object.assign(state.subscription, vals);
      // Return a snapshot clone, mirroring real Postgres RETURNING (each
      // returned row is a new object — not a live reference to the DB row).
      return [{ ...state.subscription }];
    }
    return [];
  }

  function applyDelete(table: any) {
    if (table === usageTable) {
      const removed = state.usageCounterRows.splice(0);
      return removed;
    }
    return [];
  }

  function applyInsert(table: any, vals: Record<string, unknown>) {
    if (table === subsTable) {
      // ON CONFLICT (user_id) DO NOTHING: if subscription already exists,
      // return empty array (no rows inserted).
      if (state.subscription) return [];
      state.subscription = {
        id: `sub-${++subSeq}`,
        pendingTier: null,
        paymentOwed: false,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...vals,
      };
      // Return a snapshot clone so the caller's view doesn't change as
      // subsequent UPDATEs mutate state.subscription.
      return [{ ...state.subscription }];
    }
    if (table === eventsTable) {
      // Deep-clone the values so beforeSnapshot/afterSnapshot capture the
      // row state at insert time (matches real jsonb column behaviour —
      // otherwise subsequent UPDATEs to the same subscription row would
      // mutate the snapshot we just stored).
      const cloned = JSON.parse(JSON.stringify(vals));
      const row = { id: `evt-${++evtSeq}`, createdAt: new Date(), ...cloned };
      state.events.push(row);
      return [row];
    }
    if (table === outboxTable) {
      // Idempotency: silently skip if a row with the same key already exists.
      const existing = state.outboxRows.find(
        (r) => r.idempotencyKey === (vals as any).idempotencyKey,
      );
      if (existing) return [existing];
      const row = {
        id: `outbox-${++outboxSeq}`,
        status: 'pending',
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...vals,
      };
      state.outboxRows.push(row);
      return [row];
    }
    return [];
  }

  function buildTx() {
    return {
      query: {
        subscriptions: {
          // Return a snapshot clone so callers get a stable view independent
          // of subsequent UPDATEs (matches real Drizzle behaviour).
          findFirst: jest.fn(async () =>
            state.subscription ? { ...state.subscription } : null,
          ),
        },
      },
      update: jest.fn((table: any) => ({
        set: jest.fn((vals: Record<string, unknown>) => ({
          where: jest.fn(() => ({
            returning: jest.fn(async () => applyUpdate(table, vals)),
          })),
        })),
      })),
      delete: jest.fn((table: any) => ({
        where: jest.fn(async () => applyDelete(table)),
      })),
      insert: jest.fn((table: any) => ({
        values: jest.fn((vals: Record<string, unknown>) => {
          const inserted = applyInsert(table, vals);
          return {
            onConflictDoNothing: jest.fn(async () => inserted),
            returning: jest.fn(async () => inserted),
          };
        }),
      })),
    };
  }

  const db: any = {
    transaction: jest.fn(async (fn: (tx: any) => any) => fn(buildTx())),

    query: {
      subscriptions: {
        findFirst: jest.fn(async () =>
          state.subscription ? { ...state.subscription } : null,
        ),
      },
    },

    // Top-level insert — returns a chainable object whose .returning() yields
    // the inserted row(s). createForNewUser uses
    //   .insert(subs).values(…).onConflictDoNothing().returning()
    insert: jest.fn((table: any) => ({
      values: jest.fn((vals: Record<string, unknown>) => {
        const doInsert = () => applyInsert(table, vals);
        return {
          onConflictDoNothing: jest.fn(() => ({
            returning: jest.fn(async () => doInsert()),
            // Support fire-and-forget chains used by NotificationsService.scheduleReceipt
            catch: jest.fn(),
            then: (cb: any) => Promise.resolve(doInsert()).then(cb),
          })),
          returning: jest.fn(async () => doInsert()),
        };
      }),
    })),
  };

  return db;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function seedUsageCounter(
  state: MockState,
  feature: string,
  value: number,
  periodStart: Date,
  periodEnd: Date,
) {
  state.usageCounterRows.push({
    userId: USER_ID,
    feature,
    periodStart,
    periodEnd,
    value,
  });
}

// ── Test ──────────────────────────────────────────────────────────────────

describe('Integration: free → growth → studio upgrade lifecycle (Task 23.1)', () => {
  let state: MockState;
  let db: any;

  // Mocks
  let mockPaymentPort: {
    charge: jest.Mock;
    createMandate: jest.Mock;
    cancelMandate: jest.Mock;
    parseWebhook: jest.Mock;
  };
  let mockNotificationPort: { sendEmail: jest.Mock; sendInApp: jest.Mock };

  // Real services
  let moneyMath: MoneyMathService;
  let plansCatalog: any;
  let eventsRepo: SubscriptionEventsRepository;
  let notificationsService: NotificationsService;
  let subscriptionsService: SubscriptionsService;

  beforeEach(() => {
    state = {
      subscription: null,
      usageCounterRows: [],
      events: [],
      outboxRows: [],
    };

    db = buildMockDb(state);

    // PaymentPort mock — mirrors MockPaymentAdapter: always succeeds with a
    // unique providerRef. Every charge is recorded for assertion.
    let chargeSeq = 0;
    mockPaymentPort = {
      charge: jest.fn(async (_req: any) => ({
        success: true,
        providerRef: `mock_ch_${++chargeSeq}`,
      })),
      createMandate: jest.fn(),
      cancelMandate: jest.fn(),
      parseWebhook: jest.fn(),
    };

    mockNotificationPort = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
      sendInApp: jest.fn().mockResolvedValue(undefined),
    };

    moneyMath = new MoneyMathService();

    // PlansCatalogService stub — returns the canonical IN-locale rows.
    plansCatalog = {
      getPlan: jest.fn(async (tier: 'creator' | 'growth' | 'studio', locale: string) => {
        const priceByTier: Record<string, number> = {
          creator: PRICE_CREATOR,
          growth: PRICE_GROWTH,
          studio: PRICE_STUDIO,
        };
        return {
          plan: {
            tier,
            locale,
            priceMinorUnits: priceByTier[tier],
            currency: 'INR',
          },
          fallbackUsed: false,
        };
      }),
    };

    eventsRepo = new SubscriptionEventsRepository();

    notificationsService = new NotificationsService(
      db,
      mockNotificationPort as any,
    );

    // SubscriptionsService constructor signature (from subscriptions.service.ts):
    //   (subscriptionsRepository, subscriptionEventsRepository, moneyMathService,
    //    paymentPort, plansCatalogService, db, notificationsService)
    const subscriptionsRepository = {} as any;

    subscriptionsService = new SubscriptionsService(
      subscriptionsRepository,
      eventsRepo,
      moneyMath,
      mockPaymentPort as any,
      plansCatalog,
      db,
      notificationsService,
    );
  });

  // ── Step 1: provision creator subscription on signup ────────────────────

  it('Step 1 — createForNewUser provisions a free creator subscription with a 30-day period', async () => {
    const before = Date.now();
    const sub = await subscriptionsService.createForNewUser(USER_ID, LOCALE);
    const after = Date.now();

    expect(sub).toBeDefined();
    expect(sub.userId).toBe(USER_ID);
    expect(sub.tier).toBe('creator');
    expect(sub.status).toBe('active');
    expect(sub.locale).toBe(LOCALE);
    expect(sub.pendingTier).toBeNull();
    expect(sub.paymentOwed).toBe(false);

    // currentPeriodStart is "now" (within the test's wall-clock window)
    const startMs = (sub.currentPeriodStart as Date).getTime();
    expect(startMs).toBeGreaterThanOrEqual(before);
    expect(startMs).toBeLessThanOrEqual(after);

    // period is exactly 30 days
    const lengthMs =
      (sub.currentPeriodEnd as Date).getTime() -
      (sub.currentPeriodStart as Date).getTime();
    expect(lengthMs).toBe(30 * DAY_MS);

    // No charge attempted on signup (creator tier is free)
    expect(mockPaymentPort.charge).not.toHaveBeenCalled();
  });

  // ── Step 2: full lifecycle creator → growth → studio ────────────────────

  it('full lifecycle: creator → growth (full charge, fresh period, counters reset) → studio (prorated, period preserved, counters preserved)', async () => {
    // ── Provision creator subscription ────────────────────────────────────
    const created = await subscriptionsService.createForNewUser(USER_ID, LOCALE);
    const creatorPeriodStart = created.currentPeriodStart as Date;
    const creatorPeriodEnd = created.currentPeriodEnd as Date;

    // Seed a couple of usage counter rows in the creator period to prove
    // they get reset on the free → paid upgrade.
    seedUsageCounter(state, 'application_outbound', 0, creatorPeriodStart, creatorPeriodEnd);
    seedUsageCounter(state, 'ai_tool', 0, creatorPeriodStart, creatorPeriodEnd);
    expect(state.usageCounterRows).toHaveLength(2);

    // ── Upgrade creator → growth ──────────────────────────────────────────
    const beforeGrowth = Date.now();
    const growthSub = await subscriptionsService.upgrade(USER_ID, 'growth');
    const afterGrowth = Date.now();

    // Tier change + status preserved (Req 6.1, 6.2)
    expect(growthSub.tier).toBe('growth');
    expect(growthSub.status).toBe('active');
    expect(growthSub.pendingTier).toBeNull();

    // PaymentPort.charge called with the FULL growth price (Req 6.2)
    expect(mockPaymentPort.charge).toHaveBeenCalledTimes(1);
    const growthChargeCall = mockPaymentPort.charge.mock.calls[0][0];
    expect(growthChargeCall.userId).toBe(USER_ID);
    expect(growthChargeCall.amountMinor).toBe(PRICE_GROWTH);
    expect(growthChargeCall.currency).toBe('INR');
    // Idempotency key format (per design §Idempotency): action:subId:tier:periodStart
    expect(growthChargeCall.idempotencyKey).toMatch(/^upgrade:.+:growth:/);

    // Fresh 30-day period anchored at "now" (Req 6.2)
    const growthStartMs = (growthSub.currentPeriodStart as Date).getTime();
    expect(growthStartMs).toBeGreaterThanOrEqual(beforeGrowth);
    expect(growthStartMs).toBeLessThanOrEqual(afterGrowth);
    const growthLengthMs =
      (growthSub.currentPeriodEnd as Date).getTime() - growthStartMs;
    expect(growthLengthMs).toBe(30 * DAY_MS);

    // Usage counters reset to 0 (Req 6.2)
    expect(state.usageCounterRows).toHaveLength(0);

    // tier_upgraded audit event appended (Req 6.5, 24.2)
    const upgradeEvents1 = state.events.filter(
      (e) => e.eventType === 'tier_upgraded',
    );
    expect(upgradeEvents1).toHaveLength(1);
    expect(upgradeEvents1[0].userId).toBe(USER_ID);
    expect(upgradeEvents1[0].actorType).toBe('user');
    expect((upgradeEvents1[0].beforeSnapshot as any).tier).toBe('creator');
    expect((upgradeEvents1[0].afterSnapshot as any).tier).toBe('growth');

    // ── Mid-period state: simulate elapsed time and seed usage counters ───
    //
    // The growth period started "now". To exercise the paid → paid prorated
    // path with a meaningful elapsed-days value, we shift the stored
    // currentPeriodStart back by `elapsedDays`. The end-of-period stays
    // 30 days from the original start (anniversary preservation).
    const elapsedDays = 10;
    const shiftedStart = new Date(growthStartMs - elapsedDays * DAY_MS);
    const preservedEnd = new Date(
      shiftedStart.getTime() + 30 * DAY_MS,
    );
    state.subscription.currentPeriodStart = shiftedStart;
    state.subscription.currentPeriodEnd = preservedEnd;

    // Seed counters in the (now-shifted) growth period to prove they are
    // PRESERVED across the paid → paid upgrade (Req 6.4).
    seedUsageCounter(state, 'application_outbound', 4, shiftedStart, preservedEnd);
    seedUsageCounter(state, 'ai_tool', 7, shiftedStart, preservedEnd);
    expect(state.usageCounterRows).toHaveLength(2);

    // ── Upgrade growth → studio (paid → paid, mid-period) ─────────────────
    const studioSub = await subscriptionsService.upgrade(USER_ID, 'studio');

    // Tier change (Req 6.1, 6.3)
    expect(studioSub.tier).toBe('studio');
    expect(studioSub.status).toBe('active');

    // Period boundaries PRESERVED (Req 6.3, 6.6)
    expect((studioSub.currentPeriodStart as Date).getTime()).toBe(
      shiftedStart.getTime(),
    );
    expect((studioSub.currentPeriodEnd as Date).getTime()).toBe(
      preservedEnd.getTime(),
    );

    // Counters PRESERVED (Req 6.4, 6.6)
    expect(state.usageCounterRows).toHaveLength(2);
    const apps = state.usageCounterRows.find(
      (r) => r.feature === 'application_outbound',
    );
    const ai = state.usageCounterRows.find((r) => r.feature === 'ai_tool');
    expect(apps.value).toBe(4);
    expect(ai.value).toBe(7);

    // Prorated charge (Req 6.3, 6.7, 22.5):
    //   prorated = bankerRound((p2 − p1) × (30 − d) / 30)
    // The service computes elapsedDays from currentPeriodStart with
    // Math.floor((now − currentPeriodStart) / 86_400_000). Because the
    // service may compute one more whole-day boundary than the test
    // (Date.now() advances between the seed and the call), we accept the
    // prorated amount for either elapsedDays or elapsedDays + 1.
    expect(mockPaymentPort.charge).toHaveBeenCalledTimes(2);
    const studioChargeCall = mockPaymentPort.charge.mock.calls[1][0];
    expect(studioChargeCall.userId).toBe(USER_ID);
    expect(studioChargeCall.currency).toBe('INR');
    expect(studioChargeCall.idempotencyKey).toMatch(/^upgrade:.+:studio:/);

    const expectedFor = (d: number) =>
      moneyMath.proratedUpgrade(PRICE_GROWTH, PRICE_STUDIO, d, 30);
    const candidates = new Set([
      expectedFor(elapsedDays),
      expectedFor(elapsedDays + 1),
    ]);
    expect(candidates.has(studioChargeCall.amountMinor)).toBe(true);

    // Sanity bounds (Req 6.7, 22.5):
    //   0 ≤ prorated ≤ p2 − p1
    //   prorated < p2 − p1   (because d ≥ 10 > 0, some days have elapsed)
    expect(studioChargeCall.amountMinor).toBeGreaterThanOrEqual(0);
    expect(studioChargeCall.amountMinor).toBeLessThan(
      PRICE_STUDIO - PRICE_GROWTH,
    );
    // The full price difference would be 100 000 paise (₹1 000.00). At d=10
    // the prorated value is bankerRound(100 000 × 20 / 30) = 66 667.
    expect(studioChargeCall.amountMinor).toBeGreaterThan(0);

    // Second tier_upgraded audit event appended (Req 6.5, 24.2)
    const upgradeEvents2 = state.events.filter(
      (e) => e.eventType === 'tier_upgraded',
    );
    expect(upgradeEvents2).toHaveLength(2);
    const studioEvent = upgradeEvents2[1];
    expect(studioEvent.userId).toBe(USER_ID);
    expect((studioEvent.beforeSnapshot as any).tier).toBe('growth');
    expect((studioEvent.afterSnapshot as any).tier).toBe('studio');
  });

  // ── Money-math invariant: prorated < full delta when d > 0 ──────────────

  it('paid → paid upgrade prorates strictly under the full price delta when days have elapsed', async () => {
    await subscriptionsService.createForNewUser(USER_ID, LOCALE);
    await subscriptionsService.upgrade(USER_ID, 'growth');

    // Shift period start back by 15 days.
    const elapsedDays = 15;
    const shiftedStart = new Date(
      (state.subscription.currentPeriodStart as Date).getTime() -
        elapsedDays * DAY_MS,
    );
    state.subscription.currentPeriodStart = shiftedStart;
    state.subscription.currentPeriodEnd = new Date(
      shiftedStart.getTime() + 30 * DAY_MS,
    );

    await subscriptionsService.upgrade(USER_ID, 'studio');

    const studioCall = mockPaymentPort.charge.mock.calls[1][0];
    const fullDelta = PRICE_STUDIO - PRICE_GROWTH;

    // Half the period has elapsed → prorated charge is roughly half the delta.
    expect(studioCall.amountMinor).toBeLessThan(fullDelta);
    expect(studioCall.amountMinor).toBeGreaterThan(0);
    // bankerRound(100_000 × 15 / 30) = 50_000 (or 50_000 if d=16 → 46_667).
    // We just assert it falls in a sane band around half the delta.
    expect(studioCall.amountMinor).toBeGreaterThanOrEqual(
      Math.floor(fullDelta * 0.4),
    );
    expect(studioCall.amountMinor).toBeLessThanOrEqual(
      Math.ceil(fullDelta * 0.6),
    );
  });

  // ── Atomicity: each upgrade runs inside a single transaction ────────────

  it('runs each upgrade inside a single DB transaction', async () => {
    await subscriptionsService.createForNewUser(USER_ID, LOCALE);

    expect(db.transaction).not.toHaveBeenCalled();

    await subscriptionsService.upgrade(USER_ID, 'growth');
    expect(db.transaction).toHaveBeenCalledTimes(1);

    // Set up paid → paid by shifting the period start.
    state.subscription.currentPeriodStart = new Date(
      (state.subscription.currentPeriodStart as Date).getTime() - 5 * DAY_MS,
    );
    state.subscription.currentPeriodEnd = new Date(
      (state.subscription.currentPeriodStart as Date).getTime() + 30 * DAY_MS,
    );

    await subscriptionsService.upgrade(USER_ID, 'studio');
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });

  // ── Integrated post-condition snapshot ─────────────────────────────────

  it('records all required side-effects together: tier ladder + charges + counter semantics + audit', async () => {
    await subscriptionsService.createForNewUser(USER_ID, LOCALE);
    seedUsageCounter(
      state,
      'application_outbound',
      0,
      state.subscription.currentPeriodStart,
      state.subscription.currentPeriodEnd,
    );

    await subscriptionsService.upgrade(USER_ID, 'growth');

    // Mid-period state for paid → paid step.
    const elapsedDays = 7;
    const shiftedStart = new Date(
      (state.subscription.currentPeriodStart as Date).getTime() -
        elapsedDays * DAY_MS,
    );
    const preservedEnd = new Date(shiftedStart.getTime() + 30 * DAY_MS);
    state.subscription.currentPeriodStart = shiftedStart;
    state.subscription.currentPeriodEnd = preservedEnd;
    seedUsageCounter(state, 'application_outbound', 3, shiftedStart, preservedEnd);

    await subscriptionsService.upgrade(USER_ID, 'studio');

    expect({
      finalTier: state.subscription.tier,
      finalStatus: state.subscription.status,
      paymentOwed: state.subscription.paymentOwed,
      pendingTier: state.subscription.pendingTier,
      chargeCount: mockPaymentPort.charge.mock.calls.length,
      growthChargeAmount: mockPaymentPort.charge.mock.calls[0][0].amountMinor,
      eventTypes: state.events.map((e) => e.eventType),
      remainingCounters: state.usageCounterRows.length,
      remainingApplicationOutbound: state.usageCounterRows.find(
        (r) => r.feature === 'application_outbound',
      )?.value,
      periodPreservedAcrossPaidToPaid:
        (state.subscription.currentPeriodStart as Date).getTime() ===
        shiftedStart.getTime(),
    }).toEqual({
      finalTier: 'studio',
      finalStatus: 'active',
      paymentOwed: false,
      pendingTier: null,
      chargeCount: 2,
      growthChargeAmount: PRICE_GROWTH,
      eventTypes: ['tier_upgraded', 'tier_upgraded'],
      remainingCounters: 1,
      remainingApplicationOutbound: 3,
      periodPreservedAcrossPaidToPaid: true,
    });

    // The studio charge is strictly between 0 and the full price delta.
    const studioCharge = mockPaymentPort.charge.mock.calls[1][0].amountMinor;
    expect(studioCharge).toBeGreaterThan(0);
    expect(studioCharge).toBeLessThan(PRICE_STUDIO - PRICE_GROWTH);
  });
});
