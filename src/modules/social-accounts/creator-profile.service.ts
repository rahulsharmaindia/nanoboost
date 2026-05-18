// ── Creator profile persistence ──────────────────────────────
// Caches Instagram profile data in the creator_profiles table.
// Updated on every profile fetch so data stays fresh.
// Deleted when the user disconnects or requests account deletion.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { creatorProfiles } from '../../database/schema/creators.schema';
import { users } from '../../database/schema/users.schema';
import { randomUUID } from 'crypto';

export interface UpsertCreatorInput {
  providerUserId: string;
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
    if (!this.db || !input.providerUserId) return;

    try {
      const existingUsers = await this.db
        .select()
        .from(users)
        .where(eq(users.id, input.providerUserId));

      if (existingUsers.length === 0) {
        await this.db.insert(users).values({
          id: input.providerUserId,
          email: `${input.username || input.providerUserId}@creator.local`,
          role: 'creator',
        });
      }

      const existing = await this.db
        .select()
        .from(creatorProfiles)
        .where(eq(creatorProfiles.userId, input.providerUserId));

      if (existing.length === 0) {
        await this.db.insert(creatorProfiles).values({
          id: randomUUID(),
          userId: input.providerUserId,
          username: input.username ?? null,
          displayName: input.displayName ?? null,
          bio: input.bio ?? null,
          profilePictureUrl: input.profilePictureUrl ?? null,
          followerCount: input.followerCount ?? 0,
          followsCount: input.followsCount ?? 0,
          mediaCount: input.mediaCount ?? 0,
        });
        this.logger.log(`Created creator profile for ${input.username || input.providerUserId}`);
      } else {
        await this.db
          .update(creatorProfiles)
          .set({
            username: input.username ?? existing[0].username,
            displayName: input.displayName ?? existing[0].displayName,
            bio: input.bio ?? existing[0].bio,
            profilePictureUrl: input.profilePictureUrl ?? existing[0].profilePictureUrl,
            followerCount: input.followerCount ?? existing[0].followerCount,
            followsCount: input.followsCount ?? existing[0].followsCount,
            mediaCount: input.mediaCount ?? existing[0].mediaCount,
            updatedAt: new Date(),
          })
          .where(eq(creatorProfiles.userId, input.providerUserId));
      }
    } catch (err) {
      this.logger.warn(`Failed to upsert creator profile: ${(err as Error).message}`);
    }
  }

  async getNiches(providerUserId: string): Promise<string[]> {
    if (!this.db) return [];
    try {
      const rows = await this.db
        .select({ niche: creatorProfiles.niche })
        .from(creatorProfiles)
        .where(eq(creatorProfiles.userId, providerUserId));
      if (rows.length === 0 || !rows[0].niche) return [];
      return JSON.parse(rows[0].niche);
    } catch {
      return [];
    }
  }

  async updateNiches(providerUserId: string, niches: string[]): Promise<string[]> {
    if (!this.db) return niches;
    const cleaned = niches.filter((n) => n.trim().length > 0).slice(0, 3);
    await this.db
      .update(creatorProfiles)
      .set({ niche: JSON.stringify(cleaned), updatedAt: new Date() })
      .where(eq(creatorProfiles.userId, providerUserId));
    return cleaned;
  }

  async delete(providerUserId: string): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .delete(creatorProfiles)
        .where(eq(creatorProfiles.userId, providerUserId));
    } catch (err) {
      this.logger.warn(`Failed to delete creator profile: ${(err as Error).message}`);
    }
  }
}
