// ── Follows service ──────────────────────────────────────────
// Manages the set of brands an influencer follows. Persisted to
// `brand_follows` keyed on (influencer_id, brand_id) so it survives
// reinstalls and follows the influencer across devices.
//
// The API works in terms of the brand's `business_id` (the stable,
// human-readable slug); we resolve it to the internal brand_id.

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { brandFollows } from '../../database/schema/engagement.schema';
import { brands } from '../../database/schema/brands.schema';
import { NotFoundError } from '../../common/errors/app.errors';

export interface FollowedBrand {
  brandId: string;
  businessId: string;
  name: string;
  logo: string | null;
  createdAt: string;
}

@Injectable()
export class FollowsService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {
    if (!db) {
      throw new Error(
        'DATABASE_URL is not configured. FollowsService requires a database connection.',
      );
    }
  }

  private async resolveBrandId(businessId: string): Promise<string> {
    const rows = await this.db
      .select({ brandId: brands.brandId })
      .from(brands)
      .where(eq(brands.businessId, businessId));
    if (rows.length === 0) {
      throw new NotFoundError('Brand not found');
    }
    return rows[0].brandId;
  }

  async list(influencerId: string): Promise<FollowedBrand[]> {
    const rows = await this.db
      .select({
        brandId: brandFollows.brandId,
        businessId: brands.businessId,
        name: brands.name,
        logo: brands.logo,
        createdAt: brandFollows.createdAt,
      })
      .from(brandFollows)
      .innerJoin(brands, eq(brandFollows.brandId, brands.brandId))
      .where(eq(brandFollows.influencerId, influencerId))
      .orderBy(desc(brandFollows.createdAt));
    return rows.map((r: any) => ({
      brandId: r.brandId,
      businessId: r.businessId,
      name: r.name,
      logo: r.logo ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    }));
  }

  async follow(influencerId: string, businessId: string): Promise<void> {
    const trimmed = (businessId ?? '').trim();
    if (trimmed.length === 0) return;
    const brandId = await this.resolveBrandId(trimmed);
    await this.db
      .insert(brandFollows)
      .values({ influencerId, brandId })
      .onConflictDoNothing();
  }

  async unfollow(influencerId: string, businessId: string): Promise<void> {
    const trimmed = (businessId ?? '').trim();
    if (trimmed.length === 0) return;
    const brandId = await this.resolveBrandId(trimmed);
    await this.db
      .delete(brandFollows)
      .where(
        and(eq(brandFollows.influencerId, influencerId), eq(brandFollows.brandId, brandId)),
      );
  }
}
