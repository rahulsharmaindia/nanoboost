/**
 * Integration test: concurrent cap enforcement.
 *
 * Validates: Requirements 3.7 (atomic increment), 3.8 (concurrent serialization),
 *            3.10 (counter equals successful actions), 4.10 (monotonic non-decrease)
 *
 * Scenario:
 *   - Creator on tier "growth" (application_outbound cap = 10) starts the test
 *     with usage counter pre-populated to value = cap − 1 = 9.
 *   - N concurrent calls to CapEnforcerService.tryConsume() fire via
 *     Promise.all against 'application_outbound'.
 *   - Exactly one call must be allowed (the one that increments 9 → 10).
 *   - Every other call must be denied with reason === 'CAP_EXCEEDED'.
 *   - After all calls settle, the on-disk counter value must equal exactly
 *     the cap (10) — never over-incremented despite the concurrent writes.
 *
 * The atomic guard is `INSERT … ON CONFLICT DO UPDATE … WHERE value < cap`.
 * Postgres serializes the conflicting writes at the row level: only the first
 * winning UPDATE sees `value < cap`; the rest see `value = cap` and the WHERE
 * filters them, returning 0 rows affected, which the service maps to
 * CAP_EXCEEDED.
 *
 * Requires a real Postgres database via DATABASE_URL. Skipped otherwise so
 * the suite stays green in environments without DB credentials (matching
 * the pattern in test/properties/cap-enforcer.pbt.spec.ts).
 */

const HAS_DB = !!process.env.DATABASE_URL;

describe('CapEnforcerService — concurrent cap enforcement (integration)', () => {
  (HAS_DB ? describe : describe.skip)('with real Postgres', () => {
    // Imports are dynamic so the test file can be parsed in environments
    // without DATABASE_URL (the describe.skip above ensures the body never
    // runs in that case, but Jest still resolves the file).
    let pool: any;
    let db: any;
    let capEnforcerService: any;
    let schema: any;
    let drizzleOrm: any;

    beforeAll(async () => {
      const { Pool } = await import('pg');
      const { drizzle } = await import('drizzle-orm/node-postgres');
      drizzleOrm = await import('drizzle-orm');
      schema = await import('../../src/database/schema/index');

      const { CapEnforcerService } = await import(
        '../../src/modules/subscriptions/cap-enforcer.service'
      );
      const { FeatureFlagsService } = await import(
        '../../src/common/config/feature-flags.service'
      );

      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      db = drizzle(pool, { schema });

      // The CapEnforcerService bypasses cap checks when the feature flag is
      // off. Force it on for this test regardless of env, because the whole
      // point is to exercise enforcement.
      const featureFlags = new FeatureFlagsService();
      Object.defineProperty(featureFlags, 'creatorPackagesEnabled', {
        value: true,
        configurable: true,
      });
      Object.defineProperty(featureFlags, 'isCreatorPackagesEnabledForUser', {
        value: () => true,
        configurable: true,
      });

      capEnforcerService = new CapEnforcerService(db, featureFlags);

      // Ensure the 'growth'/'IN' plan exists with the expected cap of 10.
      // This makes the test self-contained even if the plans seed has not run.
      await db
        .insert(schema.plans)
        .values({
          tier: 'growth',
          locale: 'IN',
          priceMinorUnits: 49900,
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
        })
        .onConflictDoNothing({
          target: [schema.plans.tier, schema.plans.locale],
        });
    });

    afterAll(async () => {
      if (pool) await pool.end();
    });

    /**
     * Seeds a fresh subscription for `userId` on tier 'growth' / locale 'IN'
     * with a 30-day active period starting now, and pre-populates the
     * application_outbound usage counter to (cap − 1).
     */
    async function seedAtCapMinusOne(
      userId: string,
      cap: number,
    ): Promise<{ periodStart: Date; periodEnd: Date }> {
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await db
        .insert(schema.subscriptions)
        .values({
          userId,
          tier: 'growth',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          locale: 'IN',
        })
        .onConflictDoNothing({
          target: schema.subscriptions.userId,
        });

      // Pre-populate counter at value = cap − 1 so that exactly one of N
      // concurrent attempts will succeed (the one that crosses to cap).
      await db
        .insert(schema.usageCounters)
        .values({
          userId,
          feature: 'application_outbound',
          periodStart: now,
          periodEnd,
          value: cap - 1,
        })
        .onConflictDoUpdate({
          target: [
            schema.usageCounters.userId,
            schema.usageCounters.feature,
            schema.usageCounters.periodStart,
          ],
          set: { value: cap - 1, updatedAt: new Date() },
        });

      return { periodStart: now, periodEnd };
    }

    async function cleanup(userId: string): Promise<void> {
      await db
        .delete(schema.usageCounters)
        .where(drizzleOrm.eq(schema.usageCounters.userId, userId));
      await db
        .delete(schema.subscriptions)
        .where(drizzleOrm.eq(schema.subscriptions.userId, userId));
    }

    /**
     * Reads back the persisted counter value for the user/feature/period.
     */
    async function readCounter(
      userId: string,
      periodStart: Date,
    ): Promise<number> {
      const row = await db.query.usageCounters.findFirst({
        where: drizzleOrm.and(
          drizzleOrm.eq(schema.usageCounters.userId, userId),
          drizzleOrm.eq(schema.usageCounters.feature, 'application_outbound'),
          drizzleOrm.eq(schema.usageCounters.periodStart, periodStart),
        ),
      });
      return row?.value ?? 0;
    }

    it(
      'with counter at cap-1, exactly one of N concurrent tryConsume calls succeeds; counter ends at cap',
      async () => {
        const cap = 10;
        const N = 20; // 20 concurrent attempts against the last 1 unit of capacity
        const userId = `cap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const { periodStart } = await seedAtCapMinusOne(userId, cap);

        try {
          const results = await Promise.all(
            Array.from({ length: N }, () =>
              capEnforcerService.tryConsume(userId, 'application_outbound'),
            ),
          );

          const allowed = results.filter((r: any) => r.allowed === true);
          const denied = results.filter((r: any) => r.allowed === false);

          // Exactly one winner.
          expect(allowed.length).toBe(1);
          expect(denied.length).toBe(N - 1);

          // The winner's newValue is the cap (it crossed 9 → 10).
          expect(allowed[0]).toMatchObject({
            allowed: true,
            newValue: cap,
            cap,
          });

          // Every loser is a typed CAP_EXCEEDED denial — never TIER_LOCKED,
          // never an unhandled exception. This is the "CapExceededError or
          // typed error" assertion from the task.
          for (const r of denied) {
            expect(r.allowed).toBe(false);
            expect(r.reason).toBe('CAP_EXCEEDED');
            expect(r.cap).toBe(cap);
            expect(r.current).toBe(cap);
            expect(r.suggestedTier).toBe('studio');
          }

          // Counter must be exactly cap. Not over-incremented despite N writers.
          // This is the conservation invariant: persisted counter equals the
          // count of successful attempts (here 1) plus the pre-populated value
          // (cap − 1) = cap. Never cap + k for k > 0.
          const finalCounter = await readCounter(userId, periodStart);
          expect(finalCounter).toBe(cap);
        } finally {
          await cleanup(userId);
        }
      },
      60_000,
    );

    it(
      'starting from value 0 with N=50 concurrent attempts at cap=10: 10 succeed, 40 fail, counter=10',
      async () => {
        // This is the exact scenario from tasks.md task 23.8:
        //   "Spawn 50 parallel `tryConsume` against cap=10; assert exactly 10
        //    succeed and 40 fail; final counter=10."
        const cap = 10;
        const N = 50;
        const userId = `cap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const now = new Date();
        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        await db
          .insert(schema.subscriptions)
          .values({
            userId,
            tier: 'growth',
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            locale: 'IN',
          })
          .onConflictDoNothing({ target: schema.subscriptions.userId });

        try {
          const results = await Promise.all(
            Array.from({ length: N }, () =>
              capEnforcerService.tryConsume(userId, 'application_outbound'),
            ),
          );

          const allowed = results.filter((r: any) => r.allowed === true);
          const denied = results.filter((r: any) => r.allowed === false);

          expect(allowed.length).toBe(cap);
          expect(denied.length).toBe(N - cap);

          for (const r of denied) {
            expect(r.reason).toBe('CAP_EXCEEDED');
          }

          const finalCounter = await readCounter(userId, now);
          expect(finalCounter).toBe(cap);
        } finally {
          await cleanup(userId);
        }
      },
      60_000,
    );
  });

  // Sanity: the file always provides at least one runnable assertion so that
  // Jest doesn't complain about an empty suite when DATABASE_URL is absent.
  if (!HAS_DB) {
    it('skipped: set DATABASE_URL to run concurrent cap-enforcement integration test', () => {
      expect(true).toBe(true);
    });
  }
});
