// ── Plans seed runner (task 25.2) ────────────────────────────
// Loads .env, invokes seedPlans() from src/database/seed/plans.seed.ts,
// then verifies the seed by counting rows and listing (tier, locale)
// pairs. Re-runs once more to confirm idempotency.
//
// Usage: npx tsx drizzle/run-plans-seed.ts
//
// NOTE: dotenv must be configured BEFORE any module that reads
// process.env at import-time (e.g. src/config/env.ts). We therefore
// load dotenv first and use dynamic imports for everything else.

import * as dotenv from 'dotenv';
dotenv.config();

async function verify(label: string): Promise<{ count: number; rows: { tier: string; locale: string; price: number; currency: string }[] }> {
  const { Pool } = await import('pg');
  const databaseUrl = process.env.DATABASE_URL!;
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  try {
    const res = await pool.query<{ tier: string; locale: string; price_minor_units: number; currency: string }>(
      'SELECT tier, locale, price_minor_units, currency FROM plans ORDER BY tier, locale',
    );
    const count = res.rowCount ?? res.rows.length;
    console.log(`\n📋 [${label}] plans row count: ${count}`);
    console.table(res.rows);
    return {
      count,
      rows: res.rows.map((r) => ({
        tier: r.tier,
        locale: r.locale,
        price: r.price_minor_units,
        currency: r.currency,
      })),
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set.');
    process.exit(1);
  }

  // Dynamic import so dotenv has populated process.env before
  // env.ts (transitively imported by plans.seed.ts) is evaluated.
  const { seedPlans } = await import('../src/database/seed/plans.seed');

  console.log('🔄 First run of seedPlans()...');
  await seedPlans();

  const first = await verify('after first run');

  console.log('\n🔄 Second run of seedPlans() (idempotency check)...');
  await seedPlans();

  const second = await verify('after second run');

  const expected = [
    'creator|IN', 'creator|US',
    'growth|IN', 'growth|US',
    'studio|IN', 'studio|US',
  ].sort();
  const got = second.rows.map((r) => `${r.tier}|${r.locale}`).sort();
  const ok =
    second.count === 6 &&
    first.count === 6 &&
    expected.every((v, i) => v === got[i]);

  if (!ok) {
    console.error('\n❌ Verification failed.');
    console.error('   expected:', expected);
    console.error('   got:     ', got);
    process.exit(1);
  }

  console.log('\n✅ plans seed verified: 6 rows, all 3 tiers × 2 locales present, idempotent.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ run-plans-seed failed:', err);
    process.exit(1);
  });
