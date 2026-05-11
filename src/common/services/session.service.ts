// ── Session service ──────────────────────────────────────────
// DB-backed session store. A session row is created at the start
// of an OAuth flow or brand login and carries the access token /
// businessId that the guards use to authorize requests.
//
// Creator sessions additionally track:
//   - tokenExpiresAt  — when the Instagram long-lived token itself
//                       dies (~60 days from exchange/refresh).
//   - lastRefreshedAt — last successful Meta refresh call, used to
//                       honour Meta's "must be ≥24h old before you
//                       can refresh" rule.
//
// Tokens are encrypted at rest via TokenCipher (AES-256-GCM).
// Consumers always see plaintext — encryption is invisible above
// the session service boundary.
//
// No in-memory fallback: the server requires DATABASE_URL to be
// set. If it is not, startup will fail when the session service
// tries to run its first query.

import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { sessions } from '../../database/schema/sessions.schema';
import { env } from '../../config/env';
import { TokenCipher } from './token-cipher.service';

export interface SessionRecord {
  sessionId: string;
  accessToken: string | null;
  providerUserId: string | null;
  businessId: string | null;
  status: 'pending' | 'authenticated' | 'error';
  createdAt: Date;
  expiresAt: Date;
  tokenExpiresAt: Date | null;
  lastRefreshedAt: Date | null;
}

export interface CreateSessionInput {
  accessToken?: string | null;
  providerUserId?: string | null;
  businessId?: string | null;
  status?: 'pending' | 'authenticated' | 'error';
  tokenExpiresAt?: Date | null;
}

export interface UpdateSessionInput {
  accessToken?: string | null;
  providerUserId?: string | null;
  businessId?: string | null;
  status?: 'pending' | 'authenticated' | 'error';
  tokenExpiresAt?: Date | null;
  lastRefreshedAt?: Date | null;
  // When true, rolls the session-level TTL forward by sessionTtlMs.
  // Use after a successful token refresh so active users don't get
  // kicked out once the original expiresAt lapses.
  rollExpiresAt?: boolean;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DRIZZLE_CLIENT) @Optional() private readonly db: any,
    private readonly cipher: TokenCipher,
  ) {}

  private requireDb(): any {
    if (!this.db) {
      throw new Error(
        'DATABASE_URL is not configured. SessionService requires a database connection.',
      );
    }
    return this.db;
  }

  private toDate(v: unknown): Date | null {
    if (v == null) return null;
    return v instanceof Date ? v : new Date(v as any);
  }

  private mapRow(row: any): SessionRecord {
    return {
      sessionId: row.sessionId,
      accessToken: this.cipher.decrypt(row.accessToken ?? null),
      providerUserId: row.providerUserId ?? null,
      businessId: row.businessId ?? null,
      status: row.status,
      createdAt: this.toDate(row.createdAt) ?? new Date(),
      expiresAt: this.toDate(row.expiresAt) ?? new Date(),
      tokenExpiresAt: this.toDate(row.tokenExpiresAt),
      lastRefreshedAt: this.toDate(row.lastRefreshedAt),
    };
  }

  async create(input: CreateSessionInput = {}): Promise<string> {
    const db = this.requireDb();
    const expiresAt = new Date(Date.now() + env.sessionTtlMs);
    const [row] = await db
      .insert(sessions)
      .values({
        accessToken: this.cipher.encrypt(input.accessToken ?? null),
        providerUserId: input.providerUserId ?? null,
        businessId: input.businessId ?? null,
        status: input.status ?? 'pending',
        tokenExpiresAt: input.tokenExpiresAt ?? null,
        expiresAt,
      })
      .returning({ sessionId: sessions.sessionId });
    return row.sessionId;
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    if (!sessionId) return null;
    const db = this.requireDb();
    const rows = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId));
    if (rows.length === 0) return null;
    const record = this.mapRow(rows[0]);
    // Lazy expiry check — callers should treat expired sessions as missing.
    if (record.expiresAt.getTime() < Date.now()) {
      await this.remove(sessionId);
      return null;
    }
    return record;
  }

  async update(sessionId: string, patch: UpdateSessionInput): Promise<SessionRecord | null> {
    const db = this.requireDb();
    const updateData: Record<string, any> = {};
    if (patch.accessToken !== undefined) {
      updateData.accessToken = this.cipher.encrypt(patch.accessToken);
    }
    if (patch.providerUserId !== undefined) updateData.providerUserId = patch.providerUserId;
    if (patch.businessId !== undefined) updateData.businessId = patch.businessId;
    if (patch.status !== undefined) updateData.status = patch.status;
    if (patch.tokenExpiresAt !== undefined) updateData.tokenExpiresAt = patch.tokenExpiresAt;
    if (patch.lastRefreshedAt !== undefined) updateData.lastRefreshedAt = patch.lastRefreshedAt;
    if (patch.rollExpiresAt) {
      updateData.expiresAt = new Date(Date.now() + env.sessionTtlMs);
    }

    if (Object.keys(updateData).length === 0) {
      return this.get(sessionId);
    }

    await db.update(sessions).set(updateData).where(eq(sessions.sessionId, sessionId));
    return this.get(sessionId);
  }

  async remove(sessionId: string): Promise<void> {
    if (!sessionId) return;
    const db = this.requireDb();
    await db.delete(sessions).where(eq(sessions.sessionId, sessionId));
  }

  async invalidateByProviderUserId(providerUserId: string): Promise<void> {
    const db = this.requireDb();
    await db
      .update(sessions)
      .set({ status: 'error', accessToken: null })
      .where(eq(sessions.providerUserId, providerUserId));
  }

  async deleteExpired(): Promise<void> {
    const db = this.requireDb();
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }

  /**
   * Look up the access token for a creator currently authenticated under
   * the given Instagram user id. Returns null if no active session exists.
   */
  async findCreatorAccessToken(providerUserId: string): Promise<string | null> {
    const db = this.requireDb();
    const rows = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.providerUserId, providerUserId),
          eq(sessions.status, 'authenticated'),
        ),
      );
    for (const row of rows) {
      const rec = this.mapRow(row);
      if (rec.expiresAt.getTime() > Date.now() && rec.accessToken) {
        return rec.accessToken;
      }
    }
    return null;
  }
}
