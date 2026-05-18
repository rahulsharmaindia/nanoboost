// ── Integration: payment reversal ≥ 7 days ───────────────────────────────
//
// Scenario (Task 23.6):
//   1. Creator user upgraded to 'growth' 10 days ago; payment recorded as
//      succeeded at the upgrade timestamp.
//   2. Payment provider reports a charge reversal (chargeback / refund) via
//      the webhook path → SubscriptionsService.handleReversal.
//   3. Because the reversal arrives ≥ 7 days after the charge (Req 25.3),
//      refunds are NOT retroactive. The service must atomically:
//        - retain the active tier ('growth') — user is not silently demoted
//        - mark the subscription with `payment_owed = true`
//        - mark the payment row as 'reversed'
//        - append a 'payment_reversed' audit event
//        - notify the user with a payment-owed prompt
//   4. While `payment_owed = true`, further upgrades and add-on purchases
//      must be suspended until the debt is resolved (Req 25.3, 25.4).
//
// Wiring:
//   - Real SubscriptionsService, SubscriptionEventsRepository, and
//     NotificationsService instances exercise the real transactional outbox
//     flow.
//   - A stateful in-memory mock DB stands in for Postgres; it supports the
//     specific Drizzle calls handleReversal/upgrade and NotificationsService
//     make.
//   - A mock NotificationPort captures the sendInApp dispatch so the test
//     can assert the user was actually notified.
//   - A mock PaymentPort lets the test verify that a blocked upgrade never
//     attempts a charge.
//
// Validates: Requirements 25.1, 25.3, 25.4, 24.2, 26.3
// _Requirements: 25.3, 25.4_

import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { SubscriptionEventsRepository } from '../../src/modules/subscriptions/subscription-events.repository';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PaymentOwedError } from '../../src/modules/subscriptions/subscriptions.errors';
import { subscriptions as subsTable } from '../../src/database/schema/subscriptions.schema';
import { usageCounters as usageTable } from '../../src/database/schema/usage_counters.schema';
import { payments as paymentsTable } from '../../src/database/schema/payments.schema';
import { subscriptionEvents as eventsTable } from '../../src/database/schema/subscription_events.schema';
import { outbox as outboxTable } from '../../src/database/schema/outbox.schema';

// ── Test fixtures ─────────────────────────────────────────────────────────

const USER_ID = 'creator-1';
const SUB_ID = 'sub-1';
const PAYMENT_ID = 'pay-1';
const PROVIDER_REF = 'mock_charge_old123';

const CHARGED_AT = new Date('2024-01-01T00:00:00Z');
const REVERSED_AT_10D = new Date('2024-01-11T00:00:00Z'); // +10 days → ≥7d path
const PERIOD_END = new Date('2024-01-31T00:00:00Z');

// ── Mock DB factory ───────────────────────────────────────────────────────

interface MockState {
  subscription: any;
  payment: any;
  usageCounterRows: any[];
  events: any[];
  outboxRows: any[];
}

function buildMockDb(state: MockState) {
  function applyUpdate(table: any, vals: Record<string, unknown>) {
    if (table === subsTable) {
      Object.assign(state.subscription, vals);
      return [state.subscription];
    }
    if (table === paymentsTable) {
      Object.assign(state.payment, vals);
      return [state.payment];
    }
    if (table === outboxTable) {
      const claimed = state.outboxRows.filter((r) => r.status === 'pending');
      for (const r of claimed) Object.assign(r, vals);
      return claimed;
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
      const row = { id: `evt-${state.events.length + 1}`, ...vals };
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
    return [];
  }

  function buildTx() {
    return {
      query: {
        subscriptions: {
          findFirst: jest.fn(async () => state.subscription),
        },
        payments: {
          findFirst: jest.fn(async () => state.payment),
        },
      },
      update: jest.fn((table: any) => ({
        set: jest.fn((vals: Record<string, unknown>) => ({
          where: jest.fn(async () => applyUpdate(table, vals)),
          returning: jest.fn(async () => applyUpdate(table, vals)),
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

    update: jest.fn((table: any) => ({
      set: jest.fn((vals: Record<string, unknown>) => ({
        where: jest.fn(() => ({
          returning: jest.fn(async () => applyUpdate(table, vals)),
        })),
      })),
    })),

    insert: jest.fn((table: any) => ({
      values: jest.fn((vals: Record<string, unknown>) => ({
        onConflictDoNothing: jest.fn(() => ({
          catch: jest.fn(),
          then: (cb: any) => Promise.resolve(applyInsert(table, vals)).then(cb),
        })),
      })),
    })),
  };

  return db;
}

// ── Test ──────────────────────────────────────────────────────────────────

describe('Integration: payment reversal ≥ 7 days', () => {
  let state: MockState;
  let db: any;
  let mockNotificationPort: { sendEmail: jest.Mock; sendInApp: jest.Mock };
  let mockPaymentPort: { charge: jest.Mock; createMandate: jest.Mock; cancelMandate: jest.Mock; parseWebhook: jest.Mock };
  let notificationsService: NotificationsService;
  let subscriptionsService: SubscriptionsService;

  beforeEach(() => {
    // Initial fixture: creator-1 upgraded to 'growth' 10 days ago, payment
    // succeeded at the upgrade timestamp. Some usage already consumed in the
    // current period (must NOT be reset since the refund is not retroactive).
    state = {
      subscription: {
        id: SUB_ID,
        userId: USER_ID,
        tier: 'growth',
        status: 'active',
        currentPeriodStart: CHARGED_AT,
        currentPeriodEnd: PERIOD_END,
        pendingTier: null,
        paymentOwed: false,
        locale: 'IN',
        createdAt: CHARGED_AT,
        updatedAt: CHARGED_AT,
      },
      payment: {
        id: PAYMENT_ID,
        userId: USER_ID,
        amountMinorUnits: 49900, // ₹499.00 (growth tier IN)
        currency: 'INR',
        providerRef: PROVIDER_REF,
        status: 'succeeded',
        idempotencyKey: 'upgrade:sub-1:growth:2024-01-01T00:00:00.000Z',
        chargedAt: CHARGED_AT,
        reversedAt: null,
        createdAt: CHARGED_AT,
        updatedAt: CHARGED_AT,
      },
      // Pretend the user has consumed some applications and AI calls in the
      // current period — the ≥7d reversal must NOT reset these (refund is
      // not retroactive; the user keeps what they have already used).
      usageCounterRows: [
        {
          userId: USER_ID,
          feature: 'application_outbound',
          periodStart: CHARGED_AT,
          periodEnd: PERIOD_END,
          value: 4,
        },
        {
          userId: USER_ID,
          feature: 'ai_tool',
          periodStart: CHARGED_AT,
          periodEnd: PERIOD_END,
          value: 12,
        },
      ],
      events: [],
      outboxRows: [],
    };

    db = buildMockDb(state);

    const eventsRepo = new SubscriptionEventsRepository();

    mockNotificationPort = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
      sendInApp: jest.fn().mockResolvedValue(undefined),
    };

    notificationsService = new NotificationsService(
      db,
      mockNotificationPort as any,
    );

    // PaymentPort mock — used to verify a blocked upgrade never charges.
    mockPaymentPort = {
      charge: jest.fn().mockResolvedValue({ success: true, providerRef: 'should-not-be-called' }),
      createMandate: jest.fn(),
      cancelMandate: jest.fn(),
      parseWebhook: jest.fn(),
    };

    // PlansCatalogService stub — should not be reached in the blocked-upgrade
    // path because paymentOwed is checked first.
    const plansCatalog = {
      getPlan: jest.fn().mockResolvedValue({
        plan: {
          tier: 'growth',
          locale: 'IN',
          priceMinorUnits: 49900,
          currency: 'INR',
        },
      }),
    } as any;

    const moneyMath = {
      proratedUpgrade: jest.fn().mockReturnValue(0),
    } as any;
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

  // ── Subscription stays on Growth (refund not retroactive) Req 25.3 ──────

  it('retains the active tier (subscription stays on growth)', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    expect(state.subscription.tier).toBe('growth');
    expect(state.subscription.status).toBe('active');
  });

  it('does NOT reset usage counters (refund not retroactive)', async () => {
    expect(state.usageCounterRows.length).toBe(2); // pre-condition

    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    // Counters preserved — the reversal does not unwind already-consumed usage.
    expect(state.usageCounterRows.length).toBe(2);
    const apps = state.usageCounterRows.find(
      (r: any) => r.feature === 'application_outbound',
    );
    const ai = state.usageCounterRows.find(
      (r: any) => r.feature === 'ai_tool',
    );
    expect(apps.value).toBe(4);
    expect(ai.value).toBe(12);
  });

  // ── payment_owed flag set (Req 25.3) ────────────────────────────────────

  it('sets payment_owed = true on the subscription (debt recorded)', async () => {
    expect(state.subscription.paymentOwed).toBe(false); // pre-condition

    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    expect(state.subscription.paymentOwed).toBe(true);
  });

  // ── Payment marked reversed (Req 25.1) ──────────────────────────────────

  it('marks the original payment row as reversed with reversedAt set', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    expect(state.payment.status).toBe('reversed');
    expect(state.payment.reversedAt).toEqual(REVERSED_AT_10D);
  });

  // ── Audit log (Req 24.2) ────────────────────────────────────────────────

  it('appends a payment_reversed audit event in the same transaction', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    expect(state.events).toHaveLength(1);
    const event = state.events[0];
    expect(event.eventType).toBe('payment_reversed');
    expect(event.actorType).toBe('system');
    expect(event.userId).toBe(USER_ID);
    expect(event.subscriptionId).toBe(SUB_ID);
    // Reason should mention "after 7 days" to distinguish from the <7d branch.
    expect(event.reason).toMatch(/after 7 days/i);
    // Reason should mention payment_owed semantics.
    expect(event.reason).toMatch(/payment_owed/i);
  });

  // ── Notification dispatched via NotificationPort (Req 26.3) ─────────────

  it('queues a payment_owed notification in the outbox', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    expect(state.outboxRows).toHaveLength(1);
    const row = state.outboxRows[0];
    expect(row.type).toBe('in_app');
    expect((row.payload as any).type).toBe('payment_owed');
    expect((row.payload as any).userId).toBe(USER_ID);
    expect((row.payload as any).chargeId).toBe(PROVIDER_REF);
    expect(row.idempotencyKey).toContain('payment_owed');
    expect(row.idempotencyKey).toContain(SUB_ID);
  });

  it('delivers the notification through the NotificationPort once dispatched', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    expect(mockNotificationPort.sendInApp).not.toHaveBeenCalled();

    await notificationsService.dispatchPending();

    expect(mockNotificationPort.sendInApp).toHaveBeenCalledTimes(1);
    const call = mockNotificationPort.sendInApp.mock.calls[0][0];
    expect(call.userId).toBe(USER_ID);
    expect(call.type).toBe('payment_owed');
    expect(call.payload.chargeId).toBe(PROVIDER_REF);
  });

  // ── Atomicity ───────────────────────────────────────────────────────────

  it('runs the entire reversal inside a single DB transaction', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  // ── Upgrade blocked while payment_owed = true (Req 25.3) ────────────────

  it('blocks subsequent upgrade attempts with PAYMENT_OWED', async () => {
    // Reverse the payment first → payment_owed = true.
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );
    expect(state.subscription.paymentOwed).toBe(true);

    // Reset the charge spy so we can assert it's never called after this point.
    mockPaymentPort.charge.mockClear();

    // The user attempts to upgrade growth → studio. This must be rejected
    // before any payment is attempted.
    await expect(
      subscriptionsService.upgrade(USER_ID, 'studio'),
    ).rejects.toBeInstanceOf(PaymentOwedError);

    // No charge attempt was made.
    expect(mockPaymentPort.charge).not.toHaveBeenCalled();

    // Subscription is unchanged — still on growth, still owing.
    expect(state.subscription.tier).toBe('growth');
    expect(state.subscription.paymentOwed).toBe(true);
  });

  it('PaymentOwedError carries the PAYMENT_OWED code', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    try {
      await subscriptionsService.upgrade(USER_ID, 'studio');
      fail('Expected PaymentOwedError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PaymentOwedError);
      expect((err as PaymentOwedError).code).toBe('PAYMENT_OWED');
      expect((err as PaymentOwedError).userId).toBe(USER_ID);
    }
  });

  // ── Integrated post-condition snapshot ──────────────────────────────────

  it('records all required side-effects together: tier retained + counters retained + payment_owed + payment marked + audit + outbox', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_10D,
    );

    expect({
      tier: state.subscription.tier,
      status: state.subscription.status,
      paymentOwed: state.subscription.paymentOwed,
      paymentStatus: state.payment.status,
      usageCounterCount: state.usageCounterRows.length,
      eventTypes: state.events.map((e) => e.eventType),
      outboxTypes: state.outboxRows.map((r) => (r.payload as any).type),
    }).toEqual({
      tier: 'growth',
      status: 'active',
      paymentOwed: true,
      paymentStatus: 'reversed',
      usageCounterCount: 2,
      eventTypes: ['payment_reversed'],
      outboxTypes: ['payment_owed'],
    });
  });
});
