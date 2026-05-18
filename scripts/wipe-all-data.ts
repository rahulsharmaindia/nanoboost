// ── Wipe all application data ────────────────────────────────
// TRUNCATEs every table in the public schema with CASCADE and
// RESTART IDENTITY. Preserves schema and Drizzle's migration
// tracker. Use only when you want a hard reset.
//
// Usage:  npx tsx scripts/wipe-all-data.ts

import 'dotenv/config';
import { Pool } from 'pg';

const TABLES = [
  'applications',
  'submissions',
  'campaigns',
  'brand_credentials',
  'brand_profiles',
  'creator_profiles',
  'social_accounts',
  'account_deletion_requests',
  'sessions',
  'users',
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  try {
    // Count everything up front so the operator sees the impact.
    const counts: Record<string, number> = {};
    for (const t of TABLES) {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      counts[t] = r.rows[0].n;
    }
    console.log('Row counts before wipe:');
    console.table(counts);

    // Wipe in a single statement; CASCADE takes care of FK order.
    const list = TABLES.map((t) => `"${t}"`).join(', ');
    const sql = `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`;
    console.log(`\nExecuting: ${sql}`);

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    // Verify.
    const after: Record<string, number> = {};
    for (const t of TABLES) {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      after[t] = r.rows[0].n;
    }
    console.log('\nRow counts after wipe:');
    console.table(after);

    const leftover = Object.entries(after).filter(([, n]) => n > 0);
    if (leftover.length === 0) {
      console.log('\n✅ All tables are empty.');
    } else {
      console.error('\n⚠️  Some tables still have rows:', leftover);
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
