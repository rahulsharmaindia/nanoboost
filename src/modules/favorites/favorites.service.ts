// ── Favorites service ────────────────────────────────────────
// Lets an influencer save/unsave campaigns (feature #8). Backed by
// the saved_campaigns junction (influencer_id, campaign_id).

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { savedCampaigns } from '../../database/schema/engagement.schema';
import { campaigns } from '../../database/schema/campaigns.schema';
import { brands } from '../../database/schema/brands.schema';
import { NotFoundError } from '../../common/errors/app.errors';

@Injectable()
export class FavoritesService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {
    if (!db) {
      throw new Error(
        'DATABASE_URL is not configured. FavoritesService requires a database connection.',
      );
    }
  }

  async save(influencerId: string, campaignId: string): Promise<void> {
    const exists = await this.db
      .select({ id: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.campaignId, campaignId));
    if (exists.length === 0) throw new NotFoundError('Campaign not found');

    await this.db
      .insert(savedCampaigns)
      .values({ influencerId, campaignId })
      .onConflictDoNothing();
  }

  async unsave(influencerId: string, campaignId: string): Promise<void> {
    await this.db
      .delete(savedCampaigns)
      .where(
        and(
          eq(savedCampaigns.influencerId, influencerId),
          eq(savedCampaigns.campaignId, campaignId),
        ),
      );
  }

  async list(influencerId: string): Promise<any[]> {
    const rows = await this.db
      .select({
        campaignId: campaigns.campaignId,
        title: campaigns.title,
        description: campaigns.description,
        status: campaigns.status,
        preferredNiche: campaigns.preferredNiche,
        brandName: brands.name,
        businessId: brands.businessId,
        savedAt: savedCampaigns.createdAt,
      })
      .from(savedCampaigns)
      .innerJoin(campaigns, eq(savedCampaigns.campaignId, campaigns.campaignId))
      .innerJoin(brands, eq(campaigns.brandId, brands.brandId))
      .where(eq(savedCampaigns.influencerId, influencerId))
      .orderBy(desc(savedCampaigns.createdAt));
    return rows.map((r: any) => ({
      ...r,
      savedAt: r.savedAt instanceof Date ? r.savedAt.toISOString() : r.savedAt,
    }));
  }
}
