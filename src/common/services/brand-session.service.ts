// ── Brand session service ────────────────────────────────────
// Owns brand_sessions. The credential (session_id) maps to a
// brand entity. One active session per brand (partial unique
// index). Resolves businessId via a join for downstream use.

import { Inject, Injectable, Optional } from '@nestjs/common';
import { eq, lt } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { brands, brandSessions } from '../../database/schema/brands.schema';
import { env } from '../../config/env';

export interface BrandContext {
  sessionId: string;
  brandId: string;
  businessId: string;
}

@Injectable()
export class BrandSessionService {
  constructor(@Inject(DRIZZLE_CLIENT) @Optional() private readonly db: any) {}

  private requireDb(): any {
    if (!this.db) {
      throw new Error(
        'DATABASE_URL is not configured. BrandSessionService requires a database connection.',
      );
    }
    return this.db;
  }

  // Issues a fresh session, replacing any prior active one.
  async create(brandId: string): Promise<string> {
    const db = this.requireDb();
    await db.delete(brandSessions).where(eq(brandSessions.brandId, brandId));
    const expiresAt = new Date(Date.now() + env.sessionTtlMs);
    const [row] = await db
      .insert(brandSessions)
      .values({ brandId, status: 'authenticated', expiresAt })
      .returning({ sessionId: brandSessions.sessionId });
    return row.sessionId;
  }

  async getSession(sessionId: string): Promise<BrandContext | null> {
    if (!sessionId) return null;
    const db = this.requireDb();
    const rows = await db
      .select({
        sessionId: brandSessions.sessionId,
        brandId: brandSessions.brandId,
        status: brandSessions.status,
        expiresAt: brandSessions.expiresAt,
        businessId: brands.businessId,
      })
      .from(brandSessions)
      .innerJoin(brands, eq(brandSessions.brandId, brands.brandId))
      .where(eq(brandSessions.sessionId, sessionId));
    if (rows.length === 0) return null;
    const r = rows[0];
    const expiresAt = r.expiresAt instanceof Date ? r.expiresAt : new Date(r.expiresAt);
    if (expiresAt.getTime() < Date.now()) {
      await this.remove(sessionId);
      return null;
    }
    if (r.status !== 'authenticated') return null;
    return { sessionId: r.sessionId, brandId: r.brandId, businessId: r.businessId };
  }

  async remove(sessionId: string): Promise<void> {
    if (!sessionId) return;
    const db = this.requireDb();
    await db.delete(brandSessions).where(eq(brandSessions.sessionId, sessionId));
  }

  async deleteExpired(): Promise<void> {
    const db = this.requireDb();
    await db.delete(brandSessions).where(lt(brandSessions.expiresAt, new Date()));
  }
}
