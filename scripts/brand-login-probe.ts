// ── Brand login diagnostic ───────────────────────────────────
// Reproduces the server's verifyPassword logic locally against
// DATABASE_URL so we can tell exactly WHERE brand login fails:
//
//   - No profile row?     → "brand_profiles: NOT FOUND"
//   - No credential row?  → "brand_credentials: NOT FOUND"
//   - Hash mismatch?      → "scrypt: MISMATCH (password different from hash)"
//   - Happy path?         → "scrypt: MATCH"
//
// Reads the password from PROBE_PASSWORD (env var) so it never
// lands in shell history or a log file.
//
// Usage:
//   PROBE_BUSINESS_ID=1111 PROBE_PASSWORD='...' npx tsx scripts/brand-login-probe.ts

import 'dotenv/config';
import { createHash, scryptSync } from 'crypto';
import { Pool } from 'pg';

function verifyPassword(password: string, stored: string): boolean {
  if (!stored.includes(':')) {
    return createHash('sha256').update(password).digest('hex') === stored;
  }
  const [salt, hash] = stored.split(':');
  return scryptSync(password, salt, 64).toString('hex') === hash;
}

async function main() {
  const businessId = process.env.PROBE_BUSINESS_ID;
  const password = process.env.PROBE_PASSWORD;
  if (!businessId || !password) {
    console.error('Set PROBE_BUSINESS_ID and PROBE_PASSWORD env vars.');
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const dbInfo = await pool.query(
      `SELECT current_database() AS db, inet_server_addr()::text AS host`,
    );
    console.log(
      `DB: ${dbInfo.rows[0].db} @ ${dbInfo.rows[0].host ?? 'unknown'}`,
    );
    console.log(`businessId: ${businessId}`);
    console.log(`password: <${password.length} chars, provided via env>`);

    const profile = await pool.query(
      `SELECT business_id, name FROM brand_profiles WHERE business_id = $1`,
      [businessId],
    );
    if (profile.rows.length === 0) {
      console.log('❌ brand_profiles: NOT FOUND');
      return;
    }
    console.log(`✅ brand_profiles: found ("${profile.rows[0].name}")`);

    const cred = await pool.query(
      `SELECT password_hash, LENGTH(password_hash) AS len,
              POSITION(':' IN password_hash) AS colon_at,
              updated_at
         FROM brand_credentials WHERE business_id = $1`,
      [businessId],
    );
    if (cred.rows.length === 0) {
      console.log('❌ brand_credentials: NOT FOUND');
      return;
    }
    const { password_hash, len, colon_at, updated_at } = cred.rows[0];
    const format =
      colon_at === 33 && len === 161
        ? 'scrypt (salt:hash)'
        : !password_hash.includes(':') && len === 64
          ? 'legacy SHA-256'
          : `unknown (len=${len}, colon_at=${colon_at})`;
    console.log(
      `✅ brand_credentials: format=${format}, updated_at=${updated_at.toISOString()}`,
    );

    const ok = verifyPassword(password, password_hash);
    console.log(
      ok
        ? '✅ scrypt: MATCH (password corresponds to stored hash)'
        : '❌ scrypt: MISMATCH (password does not match stored hash)',
    );

    // Helpful hint: re-try common input issues without exposing password
    if (!ok) {
      const trimmed = verifyPassword(password.trim(), password_hash);
      if (trimmed) {
        console.log(
          '   ⚠️  But verification SUCCEEDS against password.trim() — input has leading/trailing whitespace.',
        );
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌', (err as Error).message);
  process.exit(1);
});
