// ── Creators service ─────────────────────────────────────────
// Provides search and listing of creator profiles for brands.

import { Inject, Injectable, Optional } from '@nestjs/common';
import { ilike, or, desc, sql } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { creatorProfiles } from '../../database/schema/creators.schema';

export interface CreatorSearchResult {
  id: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  profilePictureUrl: string | null;
  followerCount: number;
  followsCount: number;
  mediaCount: number;
  niche: string | null;
}

export interface PaginatedCreators {
  items: CreatorSearchResult[];
  page: number;
  total: number;
  hasMore: boolean;
}

@Injectable()
export class CreatorsService {
  constructor(
    @Inject(DRIZZLE_CLIENT) @Optional() private readonly db: any,
  ) {}

  async search(params: {
    query?: string;
    niche?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedCreators> {
    if (!this.db) {
      return { items: [], page: 1, total: 0, hasMore: false };
    }

    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 50);
    const offset = (page - 1) * limit;

    let baseQuery = this.db.select().from(creatorProfiles);

    const conditions: any[] = [];

    if (params.query && params.query.trim().length > 0) {
      const q = `%${params.query.trim()}%`;
      conditions.push(
        or(
          ilike(creatorProfiles.username, q),
          ilike(creatorProfiles.displayName, q),
          ilike(creatorProfiles.bio, q),
        ),
      );
    }

    if (params.niche && params.niche.trim().length > 0) {
      conditions.push(
        ilike(creatorProfiles.niche, `%${params.niche.trim()}%`),
      );
    }

    if (conditions.length > 0) {
      for (const cond of conditions) {
        baseQuery = baseQuery.where(cond);
      }
    }

    // Get total count
    let countQuery = this.db
      .select({ count: sql<number>`count(*)` })
      .from(creatorProfiles);
    if (conditions.length > 0) {
      for (const cond of conditions) {
        countQuery = countQuery.where(cond);
      }
    }
    const [{ count }] = await countQuery;
    const total = Number(count);

    // Get paginated results
    const rows = await baseQuery
      .orderBy(desc(creatorProfiles.followerCount))
      .limit(limit)
      .offset(offset);

    const items: CreatorSearchResult[] = rows.map((r: any) => ({
      id: r.id,
      userId: r.userId,
      username: r.username,
      displayName: r.displayName,
      bio: r.bio,
      profilePictureUrl: r.profilePictureUrl,
      followerCount: r.followerCount ?? 0,
      followsCount: r.followsCount ?? 0,
      mediaCount: r.mediaCount ?? 0,
      niche: r.niche,
    }));

    return {
      items,
      page,
      total,
      hasMore: offset + items.length < total,
    };
  }
}
