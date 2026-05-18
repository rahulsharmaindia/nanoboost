// ── Follows service ──────────────────────────────────────────
// Manages the set of brands a creator follows. Persisted to the
// `brand_follows` table so the follow set survives reinstalls and
// follows the creator across devices.

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { brandFollows } from '../../database/schema/follows.schema';
import { SessionService } from '../../common/services/session.service';
import { UnauthorizedError } from '../../common/errors/app.errors';

@Injectable()
export class FollowsService {
  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly sessionService: SessionService,
  ) {
    if (!db) {
      throw new Error(
        'DATABASE_URL is not configured. FollowsService requires a database connection.',
      );
    }
  }

  private async requireCreator(sessionId: string): Promise<string> {
    const session = await this.sessionService.get(sessionId);
    if (!session || !session.providerUserId) {
      throw new UnauthorizedError('Not authenticated');
    }
    return session.providerUserId;
  }

  async list(sessionId: string): Promise<Array<{ brandName: string; businessId: string | null; createdAt: string }>> {
    const influencerId = await this.requireCreator(sessionId);
    const rows = await this.db
      .select()
      .from(brandFollows)
      .where(eq(brandFollows.influencerId, influencerId))
      .orderBy(desc(brandFollows.createdAt));
    return rows.map((r: any) => ({
      brandName: r.brandName,
      businessId: r.businessId ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    }));
  }

  async follow(
    sessionId: string,
    brandName: string,
    businessId?: string | null,
  ): Promise<void> {
    const trimmed = (brandName ?? '').trim();
    if (trimmed.length === 0) return;
    const influencerId = await this.requireCreator(sessionId);
    // Insert is idempotent — uniqueIndex on (influencerId, brandName)
    // turns duplicate follows into a no-op via ON CONFLICT.
    await this.db
      .insert(brandFollows)
      .values({ influencerId, brandName: trimmed, businessId: businessId ?? null })
      .onConflictDoNothing();
  }

  async unfollow(sessionId: string, brandName: string): Promise<void> {
    const trimmed = (brandName ?? '').trim();
    if (trimmed.length === 0) return;
    const influencerId = await this.requireCreator(sessionId);
    await this.db
      .delete(brandFollows)
      .where(
        and(
          eq(brandFollows.influencerId, influencerId),
          eq(brandFollows.brandName, trimmed),
        ),
      );
  }
}
