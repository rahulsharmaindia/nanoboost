// ── Pre-migration sanity check ───────────────────────────────
// Reports what Drizzle thinks has been applied and what the DB
// actually has. Run before `drizzle-kit migrate` so we know what
// will happen.
//
// Usage:  npx tsx scripts/check-migration-state.ts

import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    // 1. Drizzle's own tracker.
    const tracker = await pool.query(`
      SELECT to_regclass('drizzle.__drizzle_migrations') AS table_exists
    `);
    const hasTracker = tracker.rows[0].table_exists !== null;
    console.log(`drizzle.__drizzle_migrations table exists: ${hasTracker}`);

    if (hasTracker) {
      const applied = await pool.query(
        'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC',
      );
      console.log(`\nApplied migrations (${applied.rows.length}):`);
      for (const row of applied.rows) {
        const ts = typeof row.created_at === 'bigint'
          ? Number(row.created_at)
          : Number(row.created_at);
        console.log(`  • ${row.hash.slice(0, 16)}…  (created_at=${ts})`);
      }
    }

    // 2. Actual DB state — targets from each migration.
    console.log('\nTable presence:');
    const tableChecks = [
      'users', 'creator_profiles', 'brand_profiles',
      'brand_credentials', 'campaigns', 'applications',
      'submissions', 'social_accounts', 'account_deletion_requests',
      'sessions',
    ];
    for (const t of tableChecks) {
      const r = await pool.query(
        `SELECT to_regclass('public.' || $1) AS exists`,
        [t],
      );
      console.log(`  • ${t.padEnd(30)} ${r.rows[0].exists !== null ? '✓' : '✗'}`);
    }

    // 3. RLS policy presence (0001 marker).
    console.log('\nRLS policies (sample from 0001):');
    const policyRes = await pool.query(`
      SELECT policyname, tablename
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname IN ('users_select_own', 'campaigns_select_published', 'submissions_insert_own')
      ORDER BY tablename, policyname
    `);
    if (policyRes.rows.length === 0) {
      console.log('  (none of the 0001 policies found)');
    } else {
      for (const row of policyRes.rows) {
        console.log(`  • ${row.tablename}.${row.policyname}`);
      }
    }

    // 4. Indexes from 0001.
    console.log('\nIndexes (sample from 0001):');
    const idxRes = await pool.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('idx_campaigns_business_id', 'idx_applications_campaign_influencer')
    `);
    if (idxRes.rows.length === 0) {
      console.log('  (0001 indexes not found)');
    } else {
      for (const row of idxRes.rows) {
        console.log(`  • ${row.tablename}.${row.indexname}`);
      }
    }

    // 5. Enum presence.
    console.log('\nEnum types:');
    const enumRes = await pool.query(`
      SELECT typname
      FROM pg_type
      WHERE typname IN ('user_role', 'campaign_status', 'application_status',
                        'submission_status', 'deletion_status', 'session_status')
      ORDER BY typname
    `);
    for (const row of enumRes.rows) {
      console.log(`  • ${row.typname}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
