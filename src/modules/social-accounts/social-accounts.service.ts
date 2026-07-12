// ── Social accounts service ──────────────────────────────────
// Fetches Instagram profile, media, and insights data.
// On profile fetch, caches data in creator_profiles (best-effort).

import { Inject, Injectable, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { MetaService } from '../meta/meta.service';
import { CreatorProfileService } from './creator-profile.service';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { influencers } from '../../database/schema/influencers.schema';

@Injectable()
export class SocialAccountsService {
  constructor(
    private readonly metaService: MetaService,
    private readonly creatorProfileService: CreatorProfileService,
    @Inject(DRIZZLE_CLIENT) @Optional() private readonly db: any,
  ) {}

  /**
   * Returns a minimal profile built from the influencer row — used for
   * Google-only influencers who have no Instagram access token. The shape
   * matches `InstagramProfile.fromJson` on the client so the profile screen
   * renders without modification.
   */
  async getProfileFromDb(influencerId: string): Promise<Record<string, unknown>> {
    if (!this.db) {
      return { id: influencerId, name: '', username: null, followers_count: 0, follows_count: 0, media_count: 0 };
    }
    const rows = await this.db
      .select()
      .from(influencers)
      .where(eq(influencers.influencerId, influencerId));
    if (rows.length === 0) {
      return { id: influencerId, name: '', username: null, followers_count: 0, follows_count: 0, media_count: 0 };
    }
    const inf = rows[0];
    return {
      id: inf.influencerId,
      name: inf.displayName || inf.username || inf.instagramHandle || '',
      username: inf.instagramHandle || inf.username || null,
      profile_picture_url: inf.profilePictureUrl || null,
      followers_count: inf.followerCount ?? 0,
      follows_count: inf.followsCount ?? 0,
      media_count: inf.mediaCount ?? 0,
      biography: inf.bio || null,
      display_name: inf.displayName || null,
      email: inf.email || null,
      contact_number: inf.contactNumber || null,
      email_verification_status: inf.emailVerificationStatus || 'unverified',
      contact_verification_status: inf.contactVerificationStatus || 'unverified',
    };
  }
  async getProfile(accessToken: string, influencerId?: string) {
    const data = await this.metaService.getUserProfile(accessToken);

    // Cache profile data on the influencers row (best-effort).
    if (influencerId) {
      this.creatorProfileService
        .upsert({
          influencerId,
          username: data.username,
          displayName: data.name,
          bio: data.biography,
          profilePictureUrl: data.profile_picture_url,
          followerCount: data.followers_count,
          followsCount: data.follows_count,
          mediaCount: data.media_count,
        })
        .catch(() => {}); // fire-and-forget
    }

    return data;
  }

  async getMedia(accessToken: string) {
    return this.metaService.getUserMedia(accessToken);
  }

  async getMediaInsights(accessToken: string, mediaId: string) {
    return this.metaService.getMediaInsights(accessToken, mediaId);
  }

  async getAccountInsights(accessToken: string, query: string) {
    return this.metaService.getAccountInsights(accessToken, query);
  }

  async getDemographicInsights(accessToken: string, metric: string, breakdown: string) {
    return this.metaService.getDemographicInsights(accessToken, metric, breakdown);
  }

  async getNiches(influencerId: string): Promise<string[]> {
    return this.creatorProfileService.getNiches(influencerId);
  }

  async updateNiches(influencerId: string, niches: string[]): Promise<string[]> {
    return this.creatorProfileService.updateNiches(influencerId, niches);
  }
}
