// ── Social accounts service ──────────────────────────────────
// Fetches Instagram profile, media, and insights data.
// On profile fetch, caches data in creator_profiles (best-effort).

import { Injectable } from '@nestjs/common';
import { MetaService } from '../meta/meta.service';
import { CreatorProfileService } from './creator-profile.service';

@Injectable()
export class SocialAccountsService {
  constructor(
    private readonly metaService: MetaService,
    private readonly creatorProfileService: CreatorProfileService,
  ) {}

  async getProfile(accessToken: string, providerUserId?: string) {
    const data = await this.metaService.getUserProfile(accessToken);

    // Cache profile data in DB (best-effort, non-blocking)
    const userId = providerUserId || data.user_id || data.id;
    if (userId) {
      this.creatorProfileService
        .upsert({
          providerUserId: String(userId),
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

  async getNiches(providerUserId: string): Promise<string[]> {
    return this.creatorProfileService.getNiches(providerUserId);
  }

  async updateNiches(providerUserId: string, niches: string[]): Promise<string[]> {
    return this.creatorProfileService.updateNiches(providerUserId, niches);
  }
}
