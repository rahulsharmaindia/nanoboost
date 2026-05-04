// ── Drizzle ORM database client ──────────────────────────────
// Use this for all normal Postgres queries.
// Use supabase.client.ts only for Auth/Storage/admin operations.

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { env } from '../config/env';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDrizzleClient() {
  if (!_db) {
    if (!env.databaseUrl) {
      // No DATABASE_URL — return null so modules can fall back gracefully
      return null;
    }
    const pool = new Pool({ connectionString: env.databaseUrl });
    _db = drizzle(pool, { schema });
  }
  return _db;
}

export type DrizzleClient = ReturnType<typeof getDrizzleClient>;
