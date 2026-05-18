// ── Cancellation integration test ─────────────────────────────────────────
//
// Validates the full cancellation lifecycle for a paid (growth) subscription:
//
//   1. cancel() sets status='canceling', preserves tier='growth',
//      preserves current_period_end, and issues no charge.
//   2. During the grace window (canceling status, before period_end), the
//      user retains full growth-tier access — verified by tryConsume on a
//      capped feature returning allowed=true with the growth cap of 10.
//   3. resume() before period_end restores status='active' with no charge,
//      retaining the original tier and current_period_end.
//   4. If the user does not resume and current_period_end is reached, the
//      period-advance scheduler atomically reverts tier='creator',
//      sets status='canceled', resets usage counters, and issues no charge.
//
// PaymentPort and NotificationPort are mocked locally so we can assert
// "no charge" semantics without depending on the catalog adapter wiring.
//
// Requires a real Postgres database (DATABASE_URL env var). Skipped in
// environments without a DB connection.
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.6, 8.8

import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env so DATABASE_URL is set before any module reads it.
// This must run at top-level — before any dynamic imports inside hooks —
// so the cached getDrizzleClient() picks up the right URL.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const HAS_DB = !!process.env.DATABASE_URL;

(HAS_DB ? describe : describe.skip)('Subscription cancellation — integration', () => {
  // ── Suite-wide handles ───────────────────────────────────────────────────
  let pool: any;
  let db: any;
  let schema: any;
  let drizzleOrm: any;

  let subscriptionsService: any;
  let capEnforcerService: any;
  let periodAdvanceScheduler: any;

  let paymentPort: MockPaymentPort;
  let notificationPort: MockNotificationPort;

  let testUserId: string;

  // ── Mock PaymentPort ─────────────────────────────────────────────────────
  // Records every charge attempt so the test can assert "no charge issued"
  // for cancel/resume/cancellation-applied paths.
  interface RecordedCharge {
    kind: 'charge' | 'mandate';
    userId: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
    description?: string;
  }

  class MockPaymentPort {
    readonly charges: RecordedCharge[] = [];

    async charge(req: any): Promise<any> {
      this.charges.push({ kind: 'charge', ...req });
      return { success: true, providerRef: `mock_${Date.now()}_${Math.random().toString(36).slice(2)}` };
    }
    async createMandate(req: any): Promise<any> {
      this.charges.push({ kind: 'mandate', ...req });
      return { success: true, providerRef: `mock_mandate_${Date.now()}` };
    }
    async cancelMandate(): Promise<void> { /* no-op */ }
    async parseWebhook(): Promise<any> { return { type: 'charge.succeeded', providerRef: '', rawPayload: {} }; }

    reset(): void { this.charges.length = 0; }
  }

  // ── Mock NotificationPort ────────────────────────────────────────────────
  // Captures sent notifications. NotificationsService writes to the outbox,
  // and we don't run the dispatcher in this test, so the port is mostly
  // here to satisfy the DI shape — but we expose recorders for symmetry.
  class MockNotificationPort {
    readonly emails: any[] = [];
    readonly inApps: any[] = [];

    async sendEmail(msg: any): Promise<void> { this.emails.push(msg); }
    async sendInApp(msg: any): Promise<void> { this.inApps.push(msg); }

    reset(): void {
      this.emails.length = 0;
      this.inApps.length = 0;
    }
  }

  // ── Setup ────────────────────────────────────────────────────────────────
  beforeAll(async () => {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    schema = await import('../../src/database/schema/index');
    drizzleOrm = await import('drizzle-orm');

    const config: any = { connectionString: process.env.DATABASE_URL };
    if (process.env.DATABASE_URL!.includes('supabase')) {
      config.ssl = { rejectUnauthorized: false };
    }
    pool = new Pool(config);
    db = drizzle(pool, { schema });

    // Ensure plans catalog is seeded — idempotent upsert, safe to re-run.
    const { seedPlans } = await import('../../src/database/seed/plans.seed');
    await seedPlans();

    // ── Wire services manually ─────────────────────────────────────────────
    const { MoneyMathService } = await import('../../src/modules/subscriptions/money-math.service');
    const { PlansCatalogService } = await import('../../src/modules/subscriptions/plans-catalog.service');
    const { SubscriptionEventsRepository } = await import(
      '../../src/modules/subscriptions/subscription-events.repository'
    );
    const { SubscriptionsRepository } = await import(
      '../../src/modules/subscriptions/subscriptions.repository'
    );
    const { CapEnforcerService } = await import(
      '../../src/modules/subscriptions/cap-enforcer.service'
    );
    const { SubscriptionsService } = await import(
      '../../src/modules/subscriptions/subscriptions.service'
    );
    const { PeriodAdvanceScheduler } = await import(
      '../../src/modules/subscriptions/schedulers/period-advance.scheduler'
    );
    const { NotificationsService } = await import(
      '../../src/modules/notifications/notifications.service'
    );

    paymentPort = new MockPaymentPort();
    notificationPort = new MockNotificationPort();

    const featureFlagsShim = {
      creatorPackagesEnabled: true,
      isCreatorPackagesEnabledForUser: () => true,
    } as any;
    const moneyMath = new MoneyMathService();
    const plansCatalog = new PlansCatalogService(db);
    plansCatalog.invalidateCache();
    const eventsRepo = new SubscriptionEventsRepository();
    const subsRepo = new SubscriptionsRepository(db);
    const notificationsService = new NotificationsService(db, notificationPort as any);

    capEnforcerService = new CapEnforcerService(db, featureFlagsShim);

    subscriptionsService = new SubscriptionsService(
      subsRepo,
      eventsRepo,
      moneyMath,
      paymentPort as any,
      plansCatalog,
      db,
      notificationsService,
    );

    periodAdvanceScheduler = new PeriodAdvanceScheduler(
      db,
      paymentPort as any,
      plansCatalog,
      eventsRepo,
      notificationsService,
    );
  }, 60_000);

  afterAll(async () => {
    // Stop the period-advance scheduler's setInterval started in onModuleInit
    // so Jest can exit cleanly.
    if (periodAdvanceScheduler && typeof periodAdvanceScheduler.onModuleDestroy === 'function') {
      periodAdvanceScheduler.onModuleDestroy();
    }
    if (pool) await pool.end();
  });

  beforeEach(() => {
    testUserId = `test-cancel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    paymentPort.reset();
    notificationPort.reset();
  });

  afterEach(async () => {
    // Clean rows for this test's user. Each user is unique per test.
    const { eq } = drizzleOrm;
    await db.delete(schema.usageCounters).where(eq(schema.usageCounters.userId, testUserId));
    await db.delete(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.userId, testUserId));
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, testUserId));
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Insert a growth-tier active subscription for the current testUserId.
   * Period defaults to (now − 5d, now + 25d) so the subscription is mid-period
   * with plenty of grace window remaining.
   */
  async function seedGrowthSubscription(opts?: {
    periodStart?: Date;
    periodEnd?: Date;
  }): Promise<any> {
    const now = new Date();
    const periodStart = opts?.periodStart ?? new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const periodEnd = opts?.periodEnd ?? new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000);

    const [row] = await db
      .insert(schema.subscriptions)
      .values({
        userId: testUserId,
        tier: 'growth',
        status: 'active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        locale: 'IN',
      })
      .returning();
    return row;
  }

  async function fetchSubscription(): Promise<any> {
    const { eq } = drizzleOrm;
    return db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.userId, testUserId),
    });
  }

  async function fetchEvents(eventType: string): Promise<any[]> {
    const { and, eq } = drizzleOrm;
    return db.query.subscriptionEvents.findMany({
      where: and(
        eq(schema.subscriptionEvents.userId, testUserId),
        eq(schema.subscriptionEvents.eventType, eventType),
      ),
    });
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  it('cancel preserves tier, period_end, and issues no charge — Req 8.1', async () => {
    const initial = await seedGrowthSubscription();
    expect(initial.tier).toBe('growth');
    expect(initial.status).toBe('active');

    // Pre-condition: no charges yet from setup.
    paymentPort.reset();

    await subscriptionsService.cancel(testUserId);

    const after = await fetchSubscription();
    expect(after.status).toBe('canceling');
    expect(after.tier).toBe('growth');
    expect(after.currentPeriodEnd.getTime()).toBe(initial.currentPeriodEnd.getTime());
    expect(after.currentPeriodStart.getTime()).toBe(initial.currentPeriodStart.getTime());

    // Req 8.4: no new charge initiated by cancel
    expect(paymentPort.charges).toHaveLength(0);

    // Req 8.8: cancellation_requested audit event appended
    const events = await fetchEvents('cancellation_requested');
    expect(events).toHaveLength(1);
    expect(events[0].actorType).toBe('user');
  });

  it('grace period: canceling status retains full growth access via tryConsume — Req 8.1', async () => {
    await seedGrowthSubscription();
    await subscriptionsService.cancel(testUserId);

    // Verify status is canceling, tier still growth.
    const sub = await fetchSubscription();
    expect(sub.status).toBe('canceling');
    expect(sub.tier).toBe('growth');

    // Consume up to the growth cap of 10 outbound applications.
    // Every attempt within the cap must be allowed during the grace window.
    const results: any[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(await capEnforcerService.tryConsume(testUserId, 'application_outbound'));
    }

    expect(results.every((r) => r.allowed === true)).toBe(true);
    // Last successful attempt should report cap=10 and newValue=10.
    const last = results[results.length - 1];
    expect(last.allowed).toBe(true);
    expect(last.cap).toBe(10);
    expect(last.newValue).toBe(10);

    // The 11th attempt is denied because the growth cap is 10 — proves the
    // cap is the growth cap, not the (cap=0) creator cap.
    const overflow = await capEnforcerService.tryConsume(testUserId, 'application_outbound');
    expect(overflow.allowed).toBe(false);
    if (!overflow.allowed) {
      expect(overflow.reason).toBe('CAP_EXCEEDED');
      expect(overflow.cap).toBe(10);
    }
  });

  it('resume restores active status with no charge and unchanged period_end — Req 8.3', async () => {
    const initial = await seedGrowthSubscription();
    await subscriptionsService.cancel(testUserId);

    paymentPort.reset();

    await subscriptionsService.resume(testUserId);

    const after = await fetchSubscription();
    expect(after.status).toBe('active');
    expect(after.tier).toBe('growth');
    expect(after.currentPeriodEnd.getTime()).toBe(initial.currentPeriodEnd.getTime());
    expect(after.currentPeriodStart.getTime()).toBe(initial.currentPeriodStart.getTime());

    // Resuming must NOT trigger a charge.
    expect(paymentPort.charges).toHaveLength(0);

    // Req 8.8: cancellation_resumed audit event appended.
    const events = await fetchEvents('cancellation_resumed');
    expect(events).toHaveLength(1);
    expect(events[0].actorType).toBe('user');
  });

  it('not resumed: period-end advance reverts to creator with no charge — Req 8.2, 8.6', async () => {
    const now = new Date();
    // Seed mid-period, then cancel, then back-date period_end so the
    // scheduler picks it up immediately. period_valid CHECK only requires
    // period_end > period_start, so a far-past start keeps the row valid.
    const initial = await seedGrowthSubscription({
      periodStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(now.getTime() + 60 * 1000), // 60s in the future
    });

    await subscriptionsService.cancel(testUserId);

    // Pre-state assertions before the period boundary is reached.
    let current = await fetchSubscription();
    expect(current.status).toBe('canceling');
    expect(current.tier).toBe('growth');

    // Simulate time passing past current_period_end by back-dating it.
    // (Avoids polling a real cron interval in tests.)
    const { eq } = drizzleOrm;
    const past = new Date(now.getTime() - 1000);
    await db
      .update(schema.subscriptions)
      .set({ currentPeriodEnd: past, updatedAt: now })
      .where(eq(schema.subscriptions.userId, testUserId));

    paymentPort.reset();

    // Drive the period-advance scheduler manually.
    await periodAdvanceScheduler.advanceDuePeriods(new Date());

    const final = await fetchSubscription();
    expect(final.tier).toBe('creator');
    expect(final.status).toBe('canceled');
    expect(final.pendingTier).toBeNull();
    // Period was advanced 30 days from the original (back-dated) period_end.
    expect(final.currentPeriodStart.getTime()).toBe(past.getTime());
    expect(final.currentPeriodEnd.getTime()).toBe(
      past.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    // Req 8.6: no charge on cancellation revert.
    // Filter to charges for our test user only — the scheduler may also
    // process unrelated leftover rows in the shared dev DB during the same
    // tick, and those charges aren't relevant here.
    const ourCharges = paymentPort.charges.filter((c) => c.userId === testUserId);
    expect(ourCharges).toHaveLength(0);

    // Req 8.8: cancellation_applied audit event appended by scheduler.
    const applied = await fetchEvents('cancellation_applied');
    expect(applied).toHaveLength(1);
    expect(applied[0].actorType).toBe('system');

    // Voiding period stamps after-snapshot for inspection
    const after = applied[0].afterSnapshot as any;
    expect(after.tier).toBe('creator');
    expect(after.status).toBe('canceled');

    // Confirm the original cancellation_requested event is also present.
    const requested = await fetchEvents('cancellation_requested');
    expect(requested).toHaveLength(1);

    // Sanity: the initial row really started as growth (regression guard).
    expect(initial.tier).toBe('growth');
  });
});
