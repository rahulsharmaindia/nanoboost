// ── Database boot probe ──────────────────────────────────────
// Runs once at startup to confirm the server is pointed at a DB
// that has the expected schema. Logs the host + database name and
// checks for tables the app depends on. A missing table is fatal
// here rather than surfacing as an obscure 500 on first request.

import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

const REQUIRED_TABLES = [
  'users',
  'brand_profiles',
  'brand_credentials',
  'campaigns',
  'applications',
  'submissions',
  'sessions',
];

export async function probeDatabase(db: any): Promise<void> {
  const logger = new Logger('DatabaseProbe');

  if (!db) {
    logger.error('No Drizzle client — skipping probe');
    return;
  }

  try {
    const meta = await db.execute(sql`
      SELECT current_database() AS db,
             inet_server_addr()::text AS host,
             current_schema() AS schema
    `);
    const row = (meta.rows ?? meta)[0] ?? {};
    logger.log(
      `Connected to database="${row.db}" host="${row.host ?? 'unknown'}" schema="${row.schema}"`,
    );

    const presence = await db.execute(sql`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY (${REQUIRED_TABLES})
    `);
    const rows = presence.rows ?? presence;
    const found = new Set<string>(rows.map((r: any) => r.table_name));
    const missing = REQUIRED_TABLES.filter((t) => !found.has(t));

    if (missing.length > 0) {
      logger.error(
        `❌ Required tables missing on this database: ${missing.join(', ')}\n` +
          `   Run migrations against this DATABASE_URL before serving requests.`,
      );
      throw new Error(
        `Database is missing required tables: ${missing.join(', ')}`,
      );
    }

    logger.log(`✅ Schema check passed (${REQUIRED_TABLES.length} tables present)`);
  } catch (err) {
    logger.error(`Database probe failed: ${(err as Error).message}`);
    throw err;
  }
}
