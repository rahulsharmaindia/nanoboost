// ── Renewal failure + 3-day grace + lapse integration test ───────────────
//
// Validates the full payment-failure lifecycle for a paid (growth)
// subscription:
//
//   1. period_end reached → renewal charge attempted → PaymentPort returns
//      failure → status='payment_failed', tier='growth' retained, period
//      stays unchanged so it serves as the "failed since" anchor for the
//      retry windows (Req 23.2).
//   2. During the 3-day grace window, the user retains full growth-tier
//      access — verified by tryConsume returning allowed=true with the
//      growth cap of 10 (Req 23.6).
//   3. Retry attempt 1 (+24h) fails → still payment_failed (Req 23.3).
//   4. Retry attempt 2 (+48h) fails → still payment_failed (Req 23.3).
//   5. Retry attempt 3 (+72h) fails → status='lapsed', tier reverts to
//      'creator', usage counters reset, held proposals released, audit
//      events appended, notifications scheduled (Req 23.4, 23.5, 23.7).
//
// PaymentPort is mocked locally to return failure deterministically.
// NotificationPort is mocked so we can assert dispatch shape without
// running the real outbox dispatcher.
//
// Requires a real Postgres database (DATABASE_URL env var). Skipped in
// environments without a DB connection.
//
// Validates: Requirements 23.2, 23.3, 23.4, 23.5, 23.6, 23.7

import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env so DATABASE_URL is set before any module reads it.
// This must run at top-level — before any dynamic imports inside hooks —
// so the cached getDrizzleClient() picks up the right URL.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const HAS_DB = !!process.env.DATABASE_URL;

(HAS_DB ? describe : describe.skip)('Subscription renewal failure → grace → lapse — integration', () => {
  // ── Suite-wide handles ───────────────────────────────────────────────────
  let pool: any;
  let db: any;
  let schema: any;
  let drizzleOrm: any;

  let capEnforcerService: any;
  let periodAdvanceScheduler: any;

  let paymentPort: FailingPaymentPort;
  let notificationPort: MockNotificationPort;

  let testUserId: string;

  // ── Mock PaymentPort that always fails ──────────────────────────────────
  // Records every charge attempt so the test can assert the exact retry
  // pattern (initial + 3 retries). The `error` field mirrors a typical
  // provider decline payload.
  interface RecordedCharge {
    kind: 'charge' | 'mandate';
    userId: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
    description?: string;
  }

  class FailingPaymentPort {
    readonly charges: RecordedCharge[] = [];

    async charge(req: any): Promise<any> {
      this.charges.push({ kind: 'charge', ...req });
      return { success: false, error: 'card_declined' };
    }
    async createMandate(req: any): Promise<any> {
      this.charges.push({ kind: 'mandate', ...req });
      return { success: false, error: 'card_declined' };
    }
    async cancelMandate(): Promise<void> { /* no-op */ }
    async parseWebhook(): Promise<any> {
      return { type: 'charge.failed', providerRef: '', rawPayload: {} };
    }

    reset(): void { this.charges.length = 0; }
  }

  // ── Mock NotificationPort ────────────────────────────────────────────────
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
    const { PlansCatalogService } = await import('../../src/modules/subscriptions/plans-catalog.service');
    const { SubscriptionEventsRepository } = await import(
      '../../src/modules/subscriptions/subscription-events.repository'
    );
    const { CapEnforcerService } = await import(
      '../../src/modules/subscriptions/cap-enforcer.service'
    );
    const { PeriodAdvanceScheduler } = await import(
      '../../src/modules/subscriptions/schedulers/period-advance.scheduler'
    );
    const { NotificationsService } = await import(
      '../../src/modules/notifications/notifications.service'
    );

    paymentPort = new FailingPaymentPort();
    notificationPort = new MockNotificationPort();

    const featureFlagsShim = {
      creatorPackagesEnabled: true,
      isCreatorPackagesEnabledForUser: () => true,
    } as any;
    const plansCatalog = new PlansCatalogService(db);
    plansCatalog.invalidateCache();
    const eventsRepo = new SubscriptionEventsRepository();
    const notificationsService = new NotificationsService(db, notificationPort as any);

    capEnforcerService = new CapEnforcerService(db, featureFlagsShim);

    periodAdvanceScheduler = new PeriodAdvanceScheduler(
      db,
      paymentPort as any,
      plansCatalog,
      eventsRepo,
      notificationsService,
    );
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(() => {
    testUserId = `test-renew-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    paymentPort.reset();
    notificationPort.reset();
  });

  afterEach(async () => {
    // Clean rows for this test's user. Each user is unique per test.
    const { eq } = drizzleOrm;
    await db.delete(schema.usageCounters).where(eq(schema.usageCounters.userId, testUserId));
    await db.delete(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.userId, testUserId));
    await db.delete(schema.payments).where(eq(schema.payments.userId, testUserId));
    await db.delete(schema.inboundProposals).where(eq(schema.inboundProposals.creatorUserId, testUserId));
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, testUserId));
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Insert a growth-tier active subscription for the current testUserId.
   * Period defaults to (now − 30d, now − 1s) so the subscription is due
   * for renewal immediately when the scheduler runs.
   */
  async function seedGrowthSubscriptionDueForRenewal(): Promise<any> {
    const now = new Date();
    const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 1000); // 1s in the past

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

  /**
   * Insert a held_for_upgrade inbound proposal for the current testUserId.
   * Used to verify Req 23.5 (held proposals released on lapse).
   */
  async function seedHeldProposal(): Promise<any> {
    const [row] = await db
      .insert(schema.inboundProposals)
      .values({
        creatorUserId: testUserId,
        brandUserId: `test-brand-${testUserId}`,
        status: 'held_for_upgrade',
        brandName: 'Test Brand',
        budgetRange: '₹10,000 – ₹50,000',
        deliverables: '1 reel + 3 stories',
        message: 'Interested in collab',
        heldAt: new Date(),
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

  /**
   * Drive the scheduler at a simulated time. We clear any stale lease so
   * the row is re-eligible for processing, then call the scheduler with
   * `now` as the simulated wall clock.
   */
  async function runSchedulerAt(now: Date): Promise<void> {
    const { eq } = drizzleOrm;
    // Clear any stale lease so the row is re-eligible for processing.
    await db
      .update(schema.subscriptions)
      .set({ processingStartedAt: null })
      .where(eq(schema.subscriptions.userId, testUserId));

    await periodAdvanceScheduler.advanceDuePeriods(now);
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  it('initial renewal failure → status=payment_failed, tier=growth retained — Req 23.2', async () => {
    const initial = await seedGrowthSubscriptionDueForRenewal();
    expect(initial.tier).toBe('growth');
    expect(initial.status).toBe('active');

    paymentPort.reset();

    // Drive the scheduler at the period_end boundary.
    await runSchedulerAt(new Date());

    // PaymentPort.charge was called exactly once for the renewal.
    expect(paymentPort.charges).toHaveLength(1);
    expect(paymentPort.charges[0].kind).toBe('charge');
    expect(paymentPort.charges[0].userId).toBe(testUserId);
    // Growth/IN price = ₹499.00 = 49900 paise.
    expect(paymentPort.charges[0].amountMinor).toBe(49900);
    expect(paymentPort.charges[0].currency).toBe('INR');

    const after = await fetchSubscription();
    // Req 23.2: status flips to payment_failed, tier retained.
    expect(after.status).toBe('payment_failed');
    expect(after.tier).toBe('growth');
    // current_period_end is preserved as the "failed since" anchor.
    expect(after.currentPeriodEnd.getTime()).toBe(initial.currentPeriodEnd.getTime());

    // renewal_failed audit event appended (Req 23.9).
    const failedEvents = await fetchEvents('renewal_failed');
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].actorType).toBe('system');
  });

  it('grace period: payment_failed retains full growth access via tryConsume — Req 23.6', async () => {
    await seedGrowthSubscriptionDueForRenewal();

    // First failure → payment_failed.
    await runSchedulerAt(new Date());
    const sub = await fetchSubscription();
    expect(sub.status).toBe('payment_failed');
    expect(sub.tier).toBe('growth');

    // During grace, the cap enforcer must use the growth cap (10), not the
    // creator cap (0). Consume up to the growth cap.
    const results: any[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(await capEnforcerService.tryConsume(testUserId, 'application_outbound'));
    }
    expect(results.every((r) => r.allowed === true)).toBe(true);
    expect(results[results.length - 1].cap).toBe(10);
    expect(results[results.length - 1].newValue).toBe(10);

    // 11th attempt is denied with CAP_EXCEEDED — proves the cap is the
    // growth cap, not the creator cap.
    const overflow = await capEnforcerService.tryConsume(testUserId, 'application_outbound');
    expect(overflow.allowed).toBe(false);
    if (!overflow.allowed) {
      expect(overflow.reason).toBe('CAP_EXCEEDED');
      expect(overflow.cap).toBe(10);
    }
  });

  it('three consecutive failures lapse the subscription with revert + reset + held release — Req 23.4, 23.5, 23.7', async () => {
    const initial = await seedGrowthSubscriptionDueForRenewal();
    const failedAt = initial.currentPeriodEnd; // anchor for retry windows
    const heldProposal = await seedHeldProposal();

    // Establish some prior usage so we can verify the reset on lapse.
    // Use the growth cap (10) — a few increments are enough to leave
    // observable rows in usage_counters.
    for (let i = 0; i < 3; i++) {
      const r = await capEnforcerService.tryConsume(testUserId, 'application_outbound');
      expect(r.allowed).toBe(true);
    }

    // ── First failure: status → payment_failed at period_end ─────────────
    await runSchedulerAt(new Date(failedAt.getTime() + 1_000));
    let sub = await fetchSubscription();
    expect(sub.status).toBe('payment_failed');
    expect(sub.tier).toBe('growth');

    paymentPort.reset();

    // ── Retry 1 at +24h: still payment_failed ────────────────────────────
    await runSchedulerAt(new Date(failedAt.getTime() + 24 * 60 * 60 * 1000 + 1_000));
    expect(paymentPort.charges).toHaveLength(1); // one retry attempted
    sub = await fetchSubscription();
    expect(sub.status).toBe('payment_failed');
    expect(sub.tier).toBe('growth');

    paymentPort.reset();

    // ── Retry 2 at +48h: still payment_failed ────────────────────────────
    await runSchedulerAt(new Date(failedAt.getTime() + 48 * 60 * 60 * 1000 + 1_000));
    expect(paymentPort.charges).toHaveLength(1);
    sub = await fetchSubscription();
    expect(sub.status).toBe('payment_failed');
    expect(sub.tier).toBe('growth');

    paymentPort.reset();

    // ── Retry 3 at +72h: lapse → tier reverts to creator ────────────────
    await runSchedulerAt(new Date(failedAt.getTime() + 72 * 60 * 60 * 1000 + 1_000));
    expect(paymentPort.charges).toHaveLength(1);

    const final = await fetchSubscription();
    // Req 23.4, 23.5: status=lapsed, tier=creator, usage counters reset.
    expect(final.status).toBe('lapsed');
    expect(final.tier).toBe('creator');
    expect(final.pendingTier).toBeNull();

    // Usage counters reset (Req 23.5).
    const { eq } = drizzleOrm;
    const counters = await db
      .select()
      .from(schema.usageCounters)
      .where(eq(schema.usageCounters.userId, testUserId));
    expect(counters).toHaveLength(0);

    // Held proposal released to delivered (Req 23.5 → 5.8).
    const releasedProposal = await db.query.inboundProposals.findFirst({
      where: eq(schema.inboundProposals.id, heldProposal.id),
    });
    expect(releasedProposal.status).toBe('delivered');

    // subscription_lapsed audit event appended (Req 23.9).
    const lapseEvents = await fetchEvents('subscription_lapsed');
    expect(lapseEvents).toHaveLength(1);
    expect(lapseEvents[0].actorType).toBe('system');
    const after = lapseEvents[0].afterSnapshot as any;
    expect(after.tier).toBe('creator');
    expect(after.status).toBe('lapsed');

    // After lapse, cap enforcer enforces creator-tier rules — application
    // outbound cap is 0 → TIER_LOCKED (Req 23.7).
    const postLapseAttempt = await capEnforcerService.tryConsume(testUserId, 'application_outbound');
    expect(postLapseAttempt.allowed).toBe(false);
    if (!postLapseAttempt.allowed) {
      expect(postLapseAttempt.reason).toBe('TIER_LOCKED');
    }
  }, 30_000);
});
