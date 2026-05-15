// ── Health check controller ──────────────────────────────────
//
// /health      — fast, never queries the DB. Railway uses this.
// /health/db   — round-trips a `SELECT 1` and reports the actual
//                host the pool is connected to. Useful for diagnosing
//                "wrong DATABASE_URL" issues without leaking the
//                credentials in the env or logs.

import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../common/decorators/public.decorator';
import { getDrizzleClient } from '../database/database.client';
import { env } from '../config/env';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  check() {
    return { status: 'ok' };
  }

  @Public()
  @Get('health/db')
  async checkDb() {
    const configured = parseDbHost(env.databaseUrl);
    const db = getDrizzleClient();
    if (!db) {
      return {
        status: 'unconfigured',
        configuredHost: configured,
      };
    }

    try {
      const meta = await db.execute(sql`
        SELECT current_database() AS db,
               inet_server_addr()::text AS host,
               current_schema() AS schema
      `);
      const row = (meta.rows ?? meta)[0] ?? {};
      return {
        status: 'ok',
        configuredHost: configured,
        connectedDatabase: row.db ?? null,
        connectedSchema: row.schema ?? null,
        connectedHost: row.host ?? null,
      };
    } catch (err) {
      return {
        status: 'error',
        configuredHost: configured,
        message: (err as Error).message,
      };
    }
  }
}

function parseDbHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}`;
  } catch {
    return null;
  }
}
