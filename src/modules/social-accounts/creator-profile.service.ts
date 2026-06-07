// ── Influencer profile persistence ───────────────────────────
// Caches Instagram profile data on the influencers row. Updated on
// every profile fetch so data stays fresh. Keyed on influencerId
// (the canonical entity id), set on the request by the auth guard.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { influencers } from '../../database/schema/influencers.schema';

export interface UpsertCreatorInput {
  influencerId: string;
  username?: string;
  displayName?: string;
  bio?: string;
  profilePictureUrl?: string;
  followerCount?: number;
  followsCount?: number;
  mediaCount?: number;
}

@Injectable()
export class CreatorProfileService {
  private readonly logger = new Logger(CreatorProfileService.name);

  constructor(@Inject(DRIZZLE_CLIENT) @Optional() private readonly db: any) {}

  async upsert(input: UpsertCreatorInput): Promise<void> {
    if (!this.db || !input.influencerId) return;
    try {
      const existing = await this.db
        .select()
        .from(influencers)
        .where(eq(influencers.influencerId, input.influencerId));
      if (existing.length === 0) return; // influencer is created at OAuth

      await this.db
        .update(influencers)
        .set({
          username: input.username ?? existing[0].username,
          displayName: input.displayName ?? existing[0].displayName,
          bio: input.bio ?? existing[0].bio,
          profilePictureUrl: input.profilePictureUrl ?? existing[0].profilePictureUrl,
          followerCount: input.followerCount ?? existing[0].followerCount,
          followsCount: input.followsCount ?? existing[0].followsCount,
          mediaCount: input.mediaCount ?? existing[0].mediaCount,
          instagramSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(influencers.influencerId, input.influencerId));
    } catch (err) {
      this.logger.warn(`Failed to upsert influencer profile: ${(err as Error).message}`);
    }
  }

  // Niches are stored as a JSON-encoded array in the `niche` column.
  async getNiches(influencerId: string): Promise<string[]> {
    if (!this.db) return [];
    try {
      const rows = await this.db
        .select({ niche: influencers.niche })
        .from(influencers)
        .where(eq(influencers.influencerId, influencerId));
      if (rows.length === 0 || !rows[0].niche) return [];
      try {
        const parsed = JSON.parse(rows[0].niche);
        return Array.isArray(parsed) ? parsed : [rows[0].niche];
      } catch {
        return [rows[0].niche];
      }
    } catch {
      return [];
    }
  }

  async updateNiches(influencerId: string, niches: string[]): Promise<string[]> {
    if (!this.db) return niches;
    const cleaned = niches.filter((n) => n.trim().length > 0).slice(0, 3);
    await this.db
      .update(influencers)
      .set({ niche: JSON.stringify(cleaned), updatedAt: new Date() })
      .where(eq(influencers.influencerId, influencerId));
    return cleaned;
  }
}
