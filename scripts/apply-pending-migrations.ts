// ── Apply pending migrations safely ──────────────────────────
// Handles the current hybrid state:
//   • 0000 tables exist but are not recorded in Drizzle's tracker.
//   • 0001 and 0002 have never been applied.
//
// Strategy:
//   1. Ensure the drizzle.__drizzle_migrations tracker exists.
//   2. Stamp 0000 as applied (tables are already there).
//   3. Apply 0001 with idempotent guards for policies/RLS.
//   4. Apply 0002 verbatim (nothing pre-exists).
//   5. Stamp 0001 and 0002 as applied.
//
// Usage:  npx tsx scripts/apply-pending-migrations.ts

import 'dotenv/config';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool, PoolClient } from 'pg';

interface Migration {
  tag: string;
  file: string;
  when: number;
}

const MIGRATIONS: Migration[] = [
  { tag: '0000_regular_boomerang',          file: '0000_regular_boomerang.sql',          when: 1777967308812 },
  { tag: '0001_indexes_and_rls',            file: '0001_indexes_and_rls.sql',            when: 1778000000000 },
  { tag: '0002_sessions_and_brand_credentials', file: '0002_sessions_and_brand_credentials.sql', when: 1778200000000 },
];

function readMigration(file: string): string {
  return readFileSync(join(process.cwd(), 'drizzle', file), 'utf8');
}

function hashSql(sql: string): string {
  // Drizzle splits on the breakpoint marker, strips it, and hashes
  // the concatenation. Match that behavior.
  const parts = sql.split('--> statement-breakpoint');
  const joined = parts.map((s) => s.trim()).join('');
  return createHash('sha256').update(joined).digest('hex');
}

async function ensureTracker(client: PoolClient) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function alreadyApplied(client: PoolClient, hash: string): Promise<boolean> {
  const res = await client.query(
    'SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1 LIMIT 1',
    [hash],
  );
  return res.rowCount !== null && res.rowCount > 0;
}

async function stamp(client: PoolClient, hash: string, when: number) {
  await client.query(
    'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
    [hash, when],
  );
}

/**
 * Runs each `--> statement-breakpoint`-separated statement individually.
 * Drops any CREATE POLICY that already exists to make re-runs safe.
 */
async function runStatements(client: PoolClient, sql: string, makeIdempotent: boolean) {
  const parts = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of parts) {
    if (makeIdempotent) {
      // CREATE POLICY cannot use IF NOT EXISTS in Postgres < 15, so
      // drop first when the statement creates a policy. Safe because
      // policy names are deterministic in these files.
      const policyMatch = stmt.match(/CREATE POLICY\s+"([^"]+)"\s+ON\s+"([^"]+)"/i);
      if (policyMatch) {
        const [, policyName, tableName] = policyMatch;
        await client.query(
          `DROP POLICY IF EXISTS "${policyName}" ON "${tableName}"`,
        );
      }
    }

    try {
      await client.query(stmt);
    } catch (err) {
      const e = err as Error & { code?: string };
      // Tolerate "already exists" errors when we intentionally run
      // a previously-applied migration for stamping.
      if (makeIdempotent && /(already exists|duplicate_object)/i.test(e.message)) {
        console.log(`  (skip — already exists) ${stmt.slice(0, 60)}…`);
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();

  try {
    await ensureTracker(client);

    for (const mig of MIGRATIONS) {
      const sql = readMigration(mig.file);
      const hash = hashSql(sql);

      if (await alreadyApplied(client, hash)) {
        console.log(`✓ ${mig.tag} — already applied, skipping`);
        continue;
      }

      if (mig.tag === '0000_regular_boomerang') {
        // Tables already live on the DB; just record it.
        console.log(`→ ${mig.tag} — tables pre-exist, stamping tracker`);
        await client.query('BEGIN');
        try {
          await stamp(client, hash, mig.when);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
        continue;
      }

      console.log(`→ ${mig.tag} — applying`);
      await client.query('BEGIN');
      try {
        const idempotent = mig.tag === '0001_indexes_and_rls';
        await runStatements(client, sql, idempotent);
        await stamp(client, hash, mig.when);
        await client.query('COMMIT');
        console.log(`✓ ${mig.tag} — applied`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('\n✅ All migrations up to date');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
