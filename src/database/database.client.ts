// ── Drizzle ORM database client ──────────────────────────────
// Use this for all normal Postgres queries.
// Use supabase.client.ts only for Auth/Storage/admin operations.

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, PoolConfig } from 'pg';
import * as schema from './schema';
import { env } from '../config/env';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDrizzleClient() {
  if (!_db) {
    if (!env.databaseUrl) {
      // No DATABASE_URL — return null so modules can surface a clear
      // error from SessionService.requireDb() instead of an obscure
      // connection failure.
      return null;
    }

    const config: PoolConfig = { connectionString: env.databaseUrl };

    // Supabase requires SSL on both the pooler (6543) and direct (5432)
    // endpoints. Accept self-signed to avoid certificate bundling in
    // deployment targets.
    if (env.databaseUrl.includes('supabase')) {
      config.ssl = { rejectUnauthorized: false };
    }

    const pool = new Pool(config);
    _db = drizzle(pool, { schema });
  }
  return _db;
}

export type DrizzleClient = ReturnType<typeof getDrizzleClient>;
