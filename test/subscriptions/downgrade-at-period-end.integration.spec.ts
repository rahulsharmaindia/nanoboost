// ── Integration: downgrade applied at period end ─────────────────────────
//
// Task 23.2 — Validates the end-to-end behaviour of a scheduled tier
// downgrade (Studio → Growth) and its application at the period boundary
// by the PeriodAdvanceScheduler.
//
// Scenario:
//   1. Creator user is on 'studio' tier, mid-period (period started 10 days
//      ago, ends 20 days from now).
//   2. User calls SubscriptionsService.scheduleDowngrade(userId, 'growth').
//      → pendingTier = 'growth' is set, but the active tier remains 'studio'
//        until the current period ends. No charge occurs at scheduling time
//        because downgrades never charge mid-period (Req 7.7).
//   3. Period boundary is simulated by setting current_period_end into the
//      past and invoking PeriodAdvanceScheduler.advanceDuePeriods(now).
//   4. The scheduler routes to the applyDowngrade path (status='active' +
//      pending_tier set) which atomically:
//        - changes tier to 'growth'
//        - clears pendingTier
//        - charges the new tier's price for the *next* period (Req 7.3)
//        - resets usage counters
//        - advances current_period_start / current_period_end by 30 days
//        - appends a 'tier_downgrade_applied' audit event
//        - schedules a downgrade_applied notification
//
// Assertions split across three phases:
//   • pre-schedule (sanity)
//   • post-schedule, pre-boundary (Req 7.1, 7.7, 7.9)
//   • post-boundary  (Req 7.3, 7.9, 4.2, 4.3, 24.2, 26.x)
//
// Wiring:
//   - Real SubscriptionsService, PeriodAdvanceScheduler,
//     SubscriptionEventsRepository, and NotificationsService instances are
//     used so we exercise the actual transactional paths.
//   - Stateful in-memory mock DB stands in for Postgres; supports the
//     specific Drizzle calls these services and the scheduler make.
//   - Mock PaymentPort records every charge so we can assert that no charge
//     fires at scheduling time and exactly one renewal-priced charge fires
//     at the boundary.
//   - Mock NotificationPort captures dispatched notifications.
//   - Mock PlansCatalogService returns the canonical growth/studio plans
//     for locale 'IN' without touching a real plans table.
//
// Validates: Requirements 7.1, 7.3, 7.7, 7.9, 4.2, 4.3, 24.2, 26.3
// _Requirements: 7.1, 7.3, 7.7, 7.9_

import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { SubscriptionEventsRepository } from '../../src/modules/subscriptions/subscription-events.repository';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PeriodAdvanceScheduler } from '../../src/modules/subscriptions/schedulers/period-advance.scheduler';
import { subscriptions as subsTable } from '../../src/database/schema/subscriptions.schema';
import { usageCounters as usageTable } from '../../src/database/schema/usage_counters.schema';
import { payments as paymentsTable } from '../../src/database/schema/payments.schema';
import { subscriptionEvents as eventsTable } from '../../src/database/schema/subscription_events.schema';
import { outbox as outboxTable } from '../../src/database/schema/outbox.schema';
import { inboundProposals as inboundProposalsTable } from '../../src/database/schema/inbound_proposals.schema';

// ── Test fixtures ─────────────────────────────────────────────────────────

const USER_ID = 'creator-1';
const SUB_ID = 'sub-1';

const PERIOD_START = new Date('2024-01-01T00:00:00Z');
const PERIOD_END = new Date('2024-01-31T00:00:00Z'); // PERIOD_START + 30 days
const MID_PERIOD = new Date('2024-01-11T00:00:00Z'); // 10 days into the period
const AFTER_BOUNDARY = new Date('2024-01-31T00:01:00Z'); // 1 minute after period end
const NEXT_PERIOD_END = new Date('2024-03-01T00:00:00Z'); // PERIOD_END + 30 days

const STUDIO_PRICE_MINOR = 149900; // ₹1,499.00
const GROWTH_PRICE_MINOR = 49900; // ₹499.00

// Plan rows the scheduler / service will resolve through PlansCatalogService.
const PLAN_GROWTH_IN = {
  tier: 'growth',
  locale: 'IN',
  priceMinorUnits: GROWTH_PRICE_MINOR,
  currency: 'INR',
  isMostPopular: true,
  analyticsWindowDays: 30,
  applicationCapMonthly: 10,
  proposalCapMonthly: 3,
  aiToolCapMonthly: 25,
  commissionPct: 10,
  concurrentCampaignsCap: 3,
  supportLevel: 'email',
  earlyAccessHours: 0,
};

const PLAN_STUDIO_IN = {
  tier: 'studio',
  locale: 'IN',
  priceMinorUnits: STUDIO_PRICE_MINOR,
  currency: 'INR',
  isMostPopular: false,
  analyticsWindowDays: 90,
  applicationCapMonthly: -1,
  proposalCapMonthly: -1,
  aiToolCapMonthly: -1,
  commissionPct: 5,
  concurrentCampaignsCap: -1,
  supportLevel: 'priority_email',
  earlyAccessHours: 24,
};

// ── Mock DB factory ───────────────────────────────────────────────────────
//
// Stateful in-memory mock supporting the Drizzle operations this test
// exercises:
//
//   SubscriptionsService.scheduleDowngrade:
//     tx.query.subscriptions.findFirst
//     tx.update(subscriptions).set(...).where(...).returning()
//     tx.insert(subscription_events).values(...)
//
//   PeriodAdvanceScheduler.advanceDuePeriods (top-level):
//     db.update(subscriptions).set({processingStartedAt}).where(...).returning()
//
//   PeriodAdvanceScheduler.processSubscription (in tx):
//     tx.query.subscriptions.findFirst
//     tx.update(subscriptions).set(...).where(...).returning()
//     tx.delete(usageCounters).where(...)
//     tx.insert(payments).values(...).onConflictDoNothing()
//     tx.insert(subscription_events).values(...)
//     tx.insert(outbox).values(...).onConflictDoNothing()
//     tx.select().from(inboundProposals).where(...).orderBy(...).limit(...)

interface MockState {
  subscription: any;
  payments: any[];
  usageCounterRows: any[];
  events: any[];
  outboxRows: any[];
  inboundProposalsRows: any[];
}

function buildMockDb(state: MockState) {
  function applyUpdate(table: any, vals: Record<string, unknown>) {
    if (table === subsTable) {
      Object.assign(state.subscription, vals);
      return [{ ...state.subscription }];
    }
    if (table === paymentsTable) {
      // Not exercised in this test, but stubbed for safety
      return [];
    }
    if (table === outboxTable) {
      const matchPending = vals.status === 'processing';
      const targets = state.outboxRows.filter((r) =>
        matchPending ? r.status === 'pending' : true,
      );
      for (const r of targets) Object.assign(r, vals);
      return targets;
    }
    if (table === inboundProposalsTable) {
      // Not exercised (no held proposals seeded), but stubbed for safety
      return [];
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
    if (table === eventsTable) {
      const row = {
        id: `evt-${state.events.length + 1}`,
        createdAt: new Date(),
        ...vals,
      };
      state.events.push(row);
      return [row];
    }
    if (table === outboxTable) {
      const existing = state.outboxRows.find(
        (r) => r.idempotencyKey === (vals as any).idempotencyKey,
      );
      if (existing) return [existing];
      const row = {
        id: `outbox-${state.outboxRows.length + 1}`,
        status: 'pending',
        attempts: 0,
        ...vals,
      };
      state.outboxRows.push(row);
      return [row];
    }
    if (table === paymentsTable) {
      const row = {
        id: `pay-${state.payments.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...vals,
      };
      state.payments.push(row);
      return [row];
    }
    return [];
  }

  function buildUpdateChain(table: any) {
    return {
      set: jest.fn((vals: Record<string, unknown>) => ({
        where: jest.fn((..._args: any[]) => {
          let cached: any[] | undefined;
          const apply = () => (cached ??= applyUpdate(table, vals));
          const thenable: any = {
            then: (onF: any, onR: any) =>
              Promise.resolve(apply()).then(onF, onR),
            returning: jest.fn(async () => apply()),
          };
          return thenable;
        }),
      })),
    };
  }

  // Held-proposal release in the scheduler does:
  //   tx.select().from(inboundProposals).where(...).orderBy(...).limit(N)
  // We don't seed any held proposals so this should always return [].
  function buildSelectChain(_columns?: any) {
    return {
      from: jest.fn((_table: any) => ({
        where: jest.fn((..._args: any[]) => ({
          orderBy: jest.fn((..._a: any[]) => ({
            limit: jest.fn(async (_n: number) => state.inboundProposalsRows),
          })),
        })),
      })),
    };
  }

  function buildTx() {
    return {
      query: {
        subscriptions: {
          findFirst: jest.fn(async () => ({ ...state.subscription })),
        },
        payments: {
          findFirst: jest.fn(async () => null),
        },
      },
      update: jest.fn((table: any) => buildUpdateChain(table)),
      delete: jest.fn((table: any) => ({
        where: jest.fn(async () => applyDelete(table)),
      })),
      insert: jest.fn((table: any) => ({
        values: jest.fn((vals: Record<string, unknown>) => {
          let inserted: any[] | undefined;
          const apply = () => (inserted ??= applyInsert(table, vals));
          return {
            onConflictDoNothing: jest.fn(async () => apply()),
            returning: jest.fn(async () => apply()),
            then: (onF: any, onR: any) =>
              Promise.resolve(apply()).then(onF, onR),
          };
        }),
      })),
      select: jest.fn((cols?: any) => buildSelectChain(cols)),
    };
  }

  const db: any = {
    transaction: jest.fn(async (fn: (tx: any) => any) => fn(buildTx())),
    update: jest.fn((table: any) => buildUpdateChain(table)),
    insert: jest.fn((table: any) => ({
      values: jest.fn((vals: Record<string, unknown>) => ({
        onConflictDoNothing: jest.fn(() => ({
          catch: jest.fn(),
          then: (cb: any) => Promise.resolve(applyInsert(table, vals)).then(cb),
        })),
      })),
    })),
    query: {
      subscriptions: {
        findFirst: jest.fn(async () => ({ ...state.subscription })),
      },
    },
    select: jest.fn((cols?: any) => buildSelectChain(cols)),
  };

  return db;
}

// ── Test ──────────────────────────────────────────────────────────────────

describe('Integration: downgrade at period end (studio → growth)', () => {
  let state: MockState;
  let db: any;
  let mockPaymentPort: { charge: jest.Mock; createMandate: jest.Mock; cancelMandate: jest.Mock; parseWebhook: jest.Mock };
  let mockNotificationPort: { sendEmail: jest.Mock; sendInApp: jest.Mock };
  let mockPlansCatalog: { getPlan: jest.Mock };
  let notificationsService: NotificationsService;
  let subscriptionsService: SubscriptionsService;
  let periodAdvanceScheduler: PeriodAdvanceScheduler;

  beforeEach(() => {
    // Initial fixture: creator-1 is on 'studio' tier, mid-period.
    state = {
      subscription: {
        id: SUB_ID,
        userId: USER_ID,
        tier: 'studio',
        status: 'active',
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
        pendingTier: null,
        paymentOwed: false,
        locale: 'IN',
        processingStartedAt: null,
        createdAt: PERIOD_START,
        updatedAt: PERIOD_START,
      },
      payments: [],
      // Pretend the user has consumed some applications and AI calls under
      // studio tier — these MUST be reset when the downgrade applies.
      usageCounterRows: [
        {
          userId: USER_ID,
          feature: 'application_outbound',
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          value: 47,
        },
        {
          userId: USER_ID,
          feature: 'ai_tool',
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          value: 132,
        },
      ],
      events: [],
      outboxRows: [],
      inboundProposalsRows: [],
    };

    db = buildMockDb(state);

    // Mock PaymentPort — captures every charge so we can assert no charge at
    // scheduling time and a single renewal-price charge at boundary time.
    mockPaymentPort = {
      charge: jest.fn(async (req: any) => ({
        success: true,
        providerRef: `mock_charge_${state.payments.length + 1}`,
      })),
      createMandate: jest.fn(),
      cancelMandate: jest.fn(),
      parseWebhook: jest.fn(),
    };

    // Mock NotificationPort — captures dispatches.
    mockNotificationPort = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
      sendInApp: jest.fn().mockResolvedValue(undefined),
    };

    // Mock PlansCatalogService — returns canonical growth/studio rows for IN.
    mockPlansCatalog = {
      getPlan: jest.fn(async (tier: string, locale: string) => {
        if (tier === 'growth' && locale === 'IN') {
          return { plan: PLAN_GROWTH_IN, fallbackUsed: false };
        }
        if (tier === 'studio' && locale === 'IN') {
          return { plan: PLAN_STUDIO_IN, fallbackUsed: false };
        }
        throw new Error(`Unexpected plan request: ${tier}/${locale}`);
      }),
    };

    const eventsRepo = new SubscriptionEventsRepository();

    notificationsService = new NotificationsService(
      db,
      mockNotificationPort as any,
    );

    // Other deps not exercised by scheduleDowngrade or the scheduler's
    // applyDowngrade path are minimal stubs.
    const moneyMath = {} as any;
    const subscriptionsRepository = {} as any;

    subscriptionsService = new SubscriptionsService(
      subscriptionsRepository,
      eventsRepo,
      moneyMath,
      mockPaymentPort as any,
      mockPlansCatalog as any,
      db,
      notificationsService,
    );

    periodAdvanceScheduler = new PeriodAdvanceScheduler(
      db,
      mockPaymentPort as any,
      mockPlansCatalog as any,
      eventsRepo,
      notificationsService,
    );
  });

  afterEach(() => {
    // PeriodAdvanceScheduler doesn't start its setInterval until onModuleInit
    // is invoked, so there's no timer to clear here. Calling onModuleDestroy
    // is a defensive no-op that keeps the suite robust if onModuleInit ever
    // gets called by accident.
    periodAdvanceScheduler.onModuleDestroy();
  });

  // ── Phase 1: Schedule the downgrade mid-period ─────────────────────────

  describe('Phase 1: scheduleDowngrade(userId, "growth") mid-period', () => {
    it('sets pendingTier = "growth" without changing the active tier (Req 7.1)', async () => {
      await subscriptionsService.scheduleDowngrade(USER_ID, 'growth');

      expect(state.subscription.pendingTier).toBe('growth');
      expect(state.subscription.tier).toBe('studio');
    });

    it('does NOT advance the current period when scheduling (Req 7.1)', async () => {
      await subscriptionsService.scheduleDowngrade(USER_ID, 'growth');

      expect(state.subscription.currentPeriodStart).toEqual(PERIOD_START);
      expect(state.subscription.currentPeriodEnd).toEqual(PERIOD_END);
    });

    it('does NOT charge mid-period — downgrades never charge until period boundary (Req 7.7)', async () => {
      await subscriptionsService.scheduleDowngrade(USER_ID, 'growth');

      expect(mockPaymentPort.charge).not.toHaveBeenCalled();
      expect(state.payments).toHaveLength(0);
    });

    it('does NOT reset usage counters mid-period (Req 7.7)', async () => {
      await subscriptionsService.scheduleDowngrade(USER_ID, 'growth');

      // Counters should still be intact — only reset at period end.
      expect(state.usageCounterRows).toHaveLength(2);
      expect(state.usageCounterRows[0].value).toBe(47);
      expect(state.usageCounterRows[1].value).toBe(132);
    });

    it('appends a tier_downgrade_requested audit event (Req 7.8, 24.1)', async () => {
      await subscriptionsService.scheduleDowngrade(USER_ID, 'growth');

      expect(state.events).toHaveLength(1);
      const evt = state.events[0];
      expect(evt.eventType).toBe('tier_downgrade_requested');
      expect(evt.actorType).toBe('user');
      expect(evt.userId).toBe(USER_ID);
      expect(evt.subscriptionId).toBe(SUB_ID);
    });
  });

  // ── Phase 2: Advance to period boundary ────────────────────────────────

  describe('Phase 2: PeriodAdvanceScheduler at period boundary', () => {
    beforeEach(async () => {
      // First, schedule the downgrade.
      await subscriptionsService.scheduleDowngrade(USER_ID, 'growth');

      // Reset payment-port calls so Phase 2 assertions are clean.
      mockPaymentPort.charge.mockClear();
    });

    it('changes tier to "growth" and clears pendingTier when period_end is reached (Req 7.3, 7.9)', async () => {
      await periodAdvanceScheduler.advanceDuePeriods(AFTER_BOUNDARY);

      expect(state.subscription.tier).toBe('growth');
      expect(state.subscription.pendingTier).toBeNull();
      expect(state.subscription.status).toBe('active');
    });

    it('starts a new 30-day period anchored at the previous period_end (Req 7.3, 4.2)', async () => {
      await periodAdvanceScheduler.advanceDuePeriods(AFTER_BOUNDARY);

      expect(state.subscription.currentPeriodStart).toEqual(PERIOD_END);
      expect(state.subscription.currentPeriodEnd).toEqual(NEXT_PERIOD_END);
    });

    it('charges exactly once at the new (lower) tier price for the next period (Req 7.3)', async () => {
      await periodAdvanceScheduler.advanceDuePeriods(AFTER_BOUNDARY);

      // Exactly one renewal charge at the boundary — never an extra/prorated
      // charge. Amount must match the new (growth) tier's monthly price, not
      // the old (studio) price.
      expect(mockPaymentPort.charge).toHaveBeenCalledTimes(1);
      const chargeReq = mockPaymentPort.charge.mock.calls[0][0];
      expect(chargeReq.amountMinor).toBe(GROWTH_PRICE_MINOR);
      expect(chargeReq.amountMinor).not.toBe(STUDIO_PRICE_MINOR);
      expect(chargeReq.currency).toBe('INR');
      expect(chargeReq.userId).toBe(USER_ID);

      // Idempotency key is constructed from the upcoming period start.
      expect(chargeReq.idempotencyKey).toContain(SUB_ID);
      expect(chargeReq.idempotencyKey).toContain('growth');
    });

    it('records the renewal charge in the payments table', async () => {
      await periodAdvanceScheduler.advanceDuePeriods(AFTER_BOUNDARY);

      expect(state.payments).toHaveLength(1);
      const pay = state.payments[0];
      expect(pay.amountMinorUnits).toBe(GROWTH_PRICE_MINOR);
      expect(pay.currency).toBe('INR');
      expect(pay.status).toBe('succeeded');
      expect(pay.userId).toBe(USER_ID);
    });

    it('resets usage counters to 0 at the boundary (Req 4.2, 4.3, 7.3)', async () => {
      // Sanity: counters are still populated coming in.
      expect(state.usageCounterRows.length).toBeGreaterThan(0);

      await periodAdvanceScheduler.advanceDuePeriods(AFTER_BOUNDARY);

      expect(state.usageCounterRows).toHaveLength(0);
    });

    it('appends a tier_downgrade_applied audit event (Req 7.3, 24.1)', async () => {
      await periodAdvanceScheduler.advanceDuePeriods(AFTER_BOUNDARY);

      const appliedEvt = state.events.find(
        (e) => e.eventType === 'tier_downgrade_applied',
      );
      expect(appliedEvt).toBeDefined();
      expect(appliedEvt.actorType).toBe('system');
      expect(appliedEvt.userId).toBe(USER_ID);
      expect(appliedEvt.subscriptionId).toBe(SUB_ID);
    });

    it('schedules a downgrade_applied notification in the outbox (Req 26.x)', async () => {
      await periodAdvanceScheduler.advanceDuePeriods(AFTER_BOUNDARY);

      const downgradeNotif = state.outboxRows.find(
        (r) => (r.payload as any).type === 'downgrade_applied',
      );
      expect(downgradeNotif).toBeDefined();
      expect((downgradeNotif!.payload as any).fromTier).toBe('studio');
      expect((downgradeNotif!.payload as any).toTier).toBe('growth');
      expect((downgradeNotif!.payload as any).userId).toBe(USER_ID);
    });

    it('clears the processing lease after applying the downgrade', async () => {
      await periodAdvanceScheduler.advanceDuePeriods(AFTER_BOUNDARY);

      expect(state.subscription.processingStartedAt).toBeNull();
    });
  });

  // ── End-to-end summary ─────────────────────────────────────────────────

  it('end-to-end: schedule + boundary produces a single coherent state transition', async () => {
    // ── Phase 1: schedule mid-period ──────────────────────────────────
    await subscriptionsService.scheduleDowngrade(USER_ID, 'growth');

    // Pre-boundary snapshot: pending set, tier unchanged, no charges.
    expect({
      tier: state.subscription.tier,
      pendingTier: state.subscription.pendingTier,
      currentPeriodEnd: state.subscription.currentPeriodEnd,
      chargeCount: mockPaymentPort.charge.mock.calls.length,
      usageCount: state.usageCounterRows.length,
      eventTypes: state.events.map((e) => e.eventType),
    }).toEqual({
      tier: 'studio',
      pendingTier: 'growth',
      currentPeriodEnd: PERIOD_END,
      chargeCount: 0,
      usageCount: 2,
      eventTypes: ['tier_downgrade_requested'],
    });

    // ── Phase 2: cross the boundary ───────────────────────────────────
    await periodAdvanceScheduler.advanceDuePeriods(AFTER_BOUNDARY);

    // Post-boundary snapshot: tier = growth, pending cleared, period rolled,
    // exactly one charge at the new tier's price, counters reset, audit +
    // notification appended.
    expect({
      tier: state.subscription.tier,
      pendingTier: state.subscription.pendingTier,
      status: state.subscription.status,
      currentPeriodStart: state.subscription.currentPeriodStart,
      currentPeriodEnd: state.subscription.currentPeriodEnd,
      processingStartedAt: state.subscription.processingStartedAt,
      chargeCount: mockPaymentPort.charge.mock.calls.length,
      chargeAmount:
        mockPaymentPort.charge.mock.calls[0]?.[0]?.amountMinor ?? null,
      paymentRowCount: state.payments.length,
      usageCount: state.usageCounterRows.length,
      eventTypes: state.events.map((e) => e.eventType).sort(),
      outboxNotifTypes: state.outboxRows
        .map((r) => (r.payload as any).type)
        .sort(),
    }).toEqual({
      tier: 'growth',
      pendingTier: null,
      status: 'active',
      currentPeriodStart: PERIOD_END,
      currentPeriodEnd: NEXT_PERIOD_END,
      processingStartedAt: null,
      chargeCount: 1,
      chargeAmount: GROWTH_PRICE_MINOR,
      paymentRowCount: 1,
      usageCount: 0,
      eventTypes: ['tier_downgrade_applied', 'tier_downgrade_requested'],
      outboxNotifTypes: ['downgrade_applied'],
    });
  });
});
