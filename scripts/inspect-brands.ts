// ── Show what is in brand-related tables ─────────────────────
// Read-only. Use before running a destructive cleanup.

import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM brand_profiles)                        AS brand_profiles,
        (SELECT COUNT(*) FROM brand_credentials)                     AS brand_credentials,
        (SELECT COUNT(*) FROM users WHERE role = 'brand')            AS brand_users,
        (SELECT COUNT(*) FROM campaigns)                             AS campaigns,
        (SELECT COUNT(*) FROM applications)                          AS applications,
        (SELECT COUNT(*) FROM submissions)                           AS submissions,
        (SELECT COUNT(*) FROM sessions WHERE business_id IS NOT NULL) AS brand_sessions
    `);
    console.log('Row counts:');
    console.table(counts.rows[0]);

    const brands = await pool.query(
      `SELECT business_id, name, industry, created_at
         FROM brand_profiles
         ORDER BY created_at DESC
         LIMIT 20`,
    );
    console.log(`\nbrand_profiles (showing up to 20):`);
    console.table(brands.rows);

    const orphanCampaigns = await pool.query(`
      SELECT c.campaign_id, c.business_id, c.title, c.status
        FROM campaigns c
        LEFT JOIN brand_profiles bp ON bp.business_id = c.business_id
       WHERE bp.business_id IS NULL
    `);
    console.log(`\nCampaigns whose brand_profile is missing: ${orphanCampaigns.rows.length}`);
    if (orphanCampaigns.rows.length > 0) console.table(orphanCampaigns.rows);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
