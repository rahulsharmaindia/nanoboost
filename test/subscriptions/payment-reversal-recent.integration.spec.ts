// ── Integration: payment reversal < 7 days ───────────────────────────────
//
// Scenario (Task 23.5):
//   1. Creator user is on 'growth' tier with a successful payment recorded
//      3 days ago.
//   2. Payment provider reports a charge reversal (chargeback / refund) via
//      the webhook path → SubscriptionsService.handleReversal.
//   3. Because the reversal arrives within 7 days of the charge (Req 25.2),
//      the service must atomically:
//        - roll the tier back to 'creator'
//        - reset usage counters
//        - mark the payment as reversed
//        - append a 'payment_reversed' audit event
//        - notify the user via NotificationPort
//
// Wiring:
//   - Real SubscriptionsService, SubscriptionEventsRepository, and
//     NotificationsService instances are used so we exercise the real
//     transactional outbox flow.
//   - A stateful in-memory mock DB stands in for Postgres; it supports the
//     specific Drizzle calls handleReversal and NotificationsService make.
//   - A mock NotificationPort captures the sendInApp dispatch so the test
//     can assert the user was actually notified once the outbox dispatcher
//     ran.
//
// Validates: Requirements 25.1, 25.2, 24.2, 26.3
// _Requirements: 25.1, 25.2_

import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { SubscriptionEventsRepository } from '../../src/modules/subscriptions/subscription-events.repository';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { subscriptions as subsTable } from '../../src/database/schema/subscriptions.schema';
import { usageCounters as usageTable } from '../../src/database/schema/usage_counters.schema';
import { payments as paymentsTable } from '../../src/database/schema/payments.schema';
import { subscriptionEvents as eventsTable } from '../../src/database/schema/subscription_events.schema';
import { outbox as outboxTable } from '../../src/database/schema/outbox.schema';

// ── Test fixtures ─────────────────────────────────────────────────────────

const USER_ID = 'creator-1';
const SUB_ID = 'sub-1';
const PAYMENT_ID = 'pay-1';
const PROVIDER_REF = 'mock_charge_abc123';

const CHARGED_AT = new Date('2024-01-01T00:00:00Z');
const REVERSED_AT_3D = new Date('2024-01-04T00:00:00Z'); // +3 days  → < 7d path
const PERIOD_END = new Date('2024-01-31T00:00:00Z');

// ── Mock DB factory ───────────────────────────────────────────────────────
//
// Builds a stateful in-memory mock DB that supports the handful of Drizzle
// operations exercised by handleReversal and NotificationsService. State is
// captured by reference so assertions can read the post-mutation values.

interface MockState {
  subscription: any;
  payment: any;
  usageCounterRows: any[];
  events: any[];
  outboxRows: any[];
}

function buildMockDb(state: MockState) {
  // Helper to dispatch operations against a specific table reference.
  // We compare table identity (===) against the imported Drizzle table refs.
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
      // The real Postgres update has a WHERE clause filtering on either
      // `status = 'pending'` (the claim path in dispatchPending) or
      // `id = row.id` (the post-dispatch update in dispatchRow). The mock
      // approximates this by routing on the new status:
      //   - vals.status === 'processing'  → claim path: only pending rows
      //   - otherwise                     → final path: all in-flight rows
      const matchPending = vals.status === 'processing';
      const targets = state.outboxRows.filter((r) =>
        matchPending ? r.status === 'pending' : true,
      );
      for (const r of targets) Object.assign(r, vals);
      return targets;
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
      // simulate ON CONFLICT DO NOTHING via idempotency key uniqueness
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

  /**
   * Build an `update(table).set(vals).where(...)` chain that:
   *   - applies the update exactly once when the chain is awaited (after
   *     `.where(...)`) OR when `.returning()` is invoked, whichever comes
   *     first;
   *   - exposes `.returning()` on the `.where(...)` result so callers that
   *     chain it (the dispatchPending claim path) still work.
   */
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

  // ── Tx interface (used inside this.db.transaction(fn)) ────────────────
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
      update: jest.fn((table: any) => buildUpdateChain(table)),
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

  // ── Top-level db (used by NotificationsService.dispatchPending) ───────
  const db: any = {
    transaction: jest.fn(async (fn: (tx: any) => any) => fn(buildTx())),

    // Top-level update — used by dispatchPending to claim pending rows
    // (chains `.returning()`) and by dispatchRow to mark rows sent
    // (awaits the `.where(...)` result directly).
    update: jest.fn((table: any) => buildUpdateChain(table)),

    // Top-level insert — used by NotificationsService.scheduleReceipt
    // (fire-and-forget). Not used in this test but stubbed for safety.
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

describe('Integration: payment reversal < 7 days', () => {
  let state: MockState;
  let db: any;
  let mockNotificationPort: { sendEmail: jest.Mock; sendInApp: jest.Mock };
  let notificationsService: NotificationsService;
  let subscriptionsService: SubscriptionsService;

  beforeEach(() => {
    // Initial fixture: creator-1 was upgraded to 'growth' on 2024-01-01,
    // payment recorded as succeeded at the same instant.
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
      // current period — the reversal must wipe these out.
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

    // Real SubscriptionEventsRepository — append() just calls tx.insert(...)
    const eventsRepo = new SubscriptionEventsRepository();

    // Mock NotificationPort — captures any sendEmail / sendInApp calls
    mockNotificationPort = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
      sendInApp: jest.fn().mockResolvedValue(undefined),
    };

    // Real NotificationsService wired to the mock port.
    notificationsService = new NotificationsService(
      db,
      mockNotificationPort as any,
    );

    // Other SubscriptionsService deps are not exercised by handleReversal,
    // so we provide minimal stubs.
    const moneyMath = {} as any;
    const paymentPort = {} as any;
    const plansCatalog = {} as any;
    const subscriptionsRepository = {} as any;

    subscriptionsService = new SubscriptionsService(
      subscriptionsRepository,
      eventsRepo,
      moneyMath,
      paymentPort,
      plansCatalog,
      db,
      notificationsService,
    );
  });

  // ── Subscription rolled back ────────────────────────────────────────────

  it('downgrades the subscription back to creator tier', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    expect(state.subscription.tier).toBe('creator');
  });

  it('clears any pending_tier and resets status to active (Req 25.2)', async () => {
    state.subscription.pendingTier = 'creator'; // pre-existing pending downgrade
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    expect(state.subscription.pendingTier).toBeNull();
    expect(state.subscription.status).toBe('active');
  });

  it('does NOT set payment_owed for a <7d reversal (only ≥7d sets it)', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    expect(state.subscription.paymentOwed).toBe(false);
  });

  // ── Payment marked reversed (Req 25.1) ──────────────────────────────────

  it('marks the original payment row as reversed with reversedAt set', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    expect(state.payment.status).toBe('reversed');
    expect(state.payment.reversedAt).toEqual(REVERSED_AT_3D);
  });

  // ── Usage counters reset (Req 25.2) ─────────────────────────────────────

  it('resets usage counters for the user (deletes counter rows)', async () => {
    expect(state.usageCounterRows.length).toBe(2); // pre-condition

    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    expect(state.usageCounterRows.length).toBe(0);
  });

  // ── Audit log (Req 24.2) ────────────────────────────────────────────────

  it('appends a payment_reversed audit event in the same transaction', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    expect(state.events).toHaveLength(1);
    const event = state.events[0];
    expect(event.eventType).toBe('payment_reversed');
    expect(event.actorType).toBe('system');
    expect(event.userId).toBe(USER_ID);
    expect(event.subscriptionId).toBe(SUB_ID);
    expect(typeof event.reason).toBe('string');
    // Reason should mention "within 7 days" to distinguish from the ≥7d branch.
    expect(event.reason).toMatch(/within 7 days/i);
  });

  // ── Notification dispatched via NotificationPort (Req 26.3) ─────────────

  it('queues a payment_reversed_rollback notification in the outbox', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    expect(state.outboxRows).toHaveLength(1);
    const row = state.outboxRows[0];
    expect(row.type).toBe('in_app');
    expect((row.payload as any).type).toBe('payment_reversed_rollback');
    expect((row.payload as any).userId).toBe(USER_ID);
    expect((row.payload as any).tier).toBe('creator');
    expect(row.idempotencyKey).toContain('payment_reversed_rollback');
    expect(row.idempotencyKey).toContain(SUB_ID);
  });

  it('delivers the notification through the NotificationPort once dispatched', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    // Sanity: NotificationPort has not been hit yet — the outbox dispatcher
    // is what bridges the queued row to the port.
    expect(mockNotificationPort.sendInApp).not.toHaveBeenCalled();

    // Run the dispatcher once — it picks up the pending outbox row and
    // forwards it to the active NotificationPort adapter.
    await notificationsService.dispatchPending();

    expect(mockNotificationPort.sendInApp).toHaveBeenCalledTimes(1);
    const call = mockNotificationPort.sendInApp.mock.calls[0][0];
    expect(call.userId).toBe(USER_ID);
    expect(call.type).toBe('payment_reversed_rollback');
    expect(call.payload.tier).toBe('creator');
    expect(call.payload.chargeId).toBe(PROVIDER_REF);
  });

  it('marks the outbox row as sent after successful dispatch', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );
    await notificationsService.dispatchPending();

    expect(state.outboxRows[0].status).toBe('sent');
  });

  // ── Atomicity / consistency ─────────────────────────────────────────────

  it('runs the entire reversal inside a single DB transaction', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    // db.transaction is invoked exactly once for the reversal flow.
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('records all required side-effects together: tier rollback + counter reset + payment marked + audit + outbox', async () => {
    await subscriptionsService.handleReversal(
      USER_ID,
      PROVIDER_REF,
      REVERSED_AT_3D,
    );

    // Single integrated assertion: every observable post-condition the
    // requirement demands is present after one call.
    expect({
      tier: state.subscription.tier,
      status: state.subscription.status,
      pendingTier: state.subscription.pendingTier,
      paymentOwed: state.subscription.paymentOwed,
      paymentStatus: state.payment.status,
      usageCounterCount: state.usageCounterRows.length,
      eventTypes: state.events.map((e) => e.eventType),
      outboxTypes: state.outboxRows.map((r) => (r.payload as any).type),
    }).toEqual({
      tier: 'creator',
      status: 'active',
      pendingTier: null,
      paymentOwed: false,
      paymentStatus: 'reversed',
      usageCounterCount: 0,
      eventTypes: ['payment_reversed'],
      outboxTypes: ['payment_reversed_rollback'],
    });
  });
});
