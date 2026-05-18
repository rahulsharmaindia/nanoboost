// Runner for the creator subscription backfill (Req 17.5, 17.6, task 25.3).
//
// Reads server/src/database/seed/backfill_subscriptions.sql, executes it,
// then reports the count of inserted rows. Idempotent — re-running prints
// `inserted: 0` once the population has converged.
//
// Usage:
//   npx tsx scripts/run_creator_backfill.ts

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const sqlPath = join(__dirname, '..', 'src', 'database', 'seed', 'backfill_subscriptions.sql');
  const rawSql = readFileSync(sqlPath, 'utf8');

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool);

  try {
    // Pre-state
    const before = await db.execute(sql`SELECT COUNT(*)::int AS count FROM subscriptions`);
    console.log('subscriptions before:', before.rows[0]);

    // Run the backfill. node-postgres returns rowCount for INSERT statements.
    const result = await pool.query(rawSql);
    console.log('inserted rows:', result.rowCount);

    const after = await db.execute(sql`SELECT COUNT(*)::int AS count FROM subscriptions`);
    console.log('subscriptions after:', after.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
