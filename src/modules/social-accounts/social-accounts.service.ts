// ── Social accounts service ──────────────────────────────────
// Fetches Instagram profile, media, and insights data.
// All Instagram API calls are delegated to MetaService.

import { Injectable } from '@nestjs/common';
import { MetaService } from '../meta/meta.service';

@Injectable()
export class SocialAccountsService {
  constructor(private readonly metaService: MetaService) {}

  async getProfile(accessToken: string) {
    return this.metaService.getUserProfile(accessToken);
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
}
