// One-off staging diagnostic script for task 25.3.
// Reports counts so we can verify backfill correctness.
//
// Usage:
//   npx tsx scripts/check_creator_backfill.ts

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool);
  try {
    const userCount = await db.execute(sql`SELECT COUNT(*)::int AS count FROM users WHERE role = 'creator'`);
    const subCount = await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM subscriptions WHERE tier = 'creator' AND status = 'active'`,
    );
    const subTotal = await db.execute(sql`SELECT COUNT(*)::int AS count FROM subscriptions`);
    const missing = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM users u
      WHERE u.role = 'creator'
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
    `);
    const orphans = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM subscriptions s
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id AND u.role = 'creator')
    `);
    console.log('Creator users:', userCount.rows[0]);
    console.log('Subscriptions (tier=creator, status=active):', subCount.rows[0]);
    console.log('Subscriptions (total):', subTotal.rows[0]);
    console.log('Creator users missing a subscription:', missing.rows[0]);
    console.log('Subscriptions whose user is not a creator (orphans):', orphans.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
