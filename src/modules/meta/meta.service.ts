// ── Meta service ─────────────────────────────────────────────
// All outbound calls to the Instagram/Meta Graph API live here.
// Never logs tokens. Never returns raw tokens to controllers.

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { ProviderError } from '../../common/errors/app.errors';

const API_BASE = `https://graph.instagram.com/${env.instagramApiVersion}`;

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  private async fetchJSON(url: string): Promise<any> {
    const res = await fetch(url);
    const data = await res.json();
    return data;
  }

  private async postForm(url: string, params: Record<string, string>): Promise<any> {
    const body = new URLSearchParams(params).toString();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    return res.json();
  }

  async exchangeCodeForToken(code: string): Promise<any> {
    return this.postForm('https://api.instagram.com/oauth/access_token', {
      client_id: env.instagramAppId,
      client_secret: env.instagramAppSecret,
      grant_type: 'authorization_code',
      redirect_uri: env.redirectUri,
      code,
    });
  }

  async getUserId(token: string): Promise<string> {
    const encode = encodeURIComponent;
    const me = await this.fetchJSON(`${API_BASE}/me?fields=user_id&access_token=${encode(token)}`);
    return me.user_id || me.id;
  }

  async getUserProfile(token: string): Promise<any> {
    const encode = encodeURIComponent;
    const fields = 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography';
    const data = await this.fetchJSON(`${API_BASE}/me?fields=${fields}&access_token=${encode(token)}`);
    if (data.error) {
      throw new ProviderError(data.error.message || 'Instagram API error');
    }
    return data;
  }

  async getUserMedia(token: string): Promise<any> {
    const encode = encodeURIComponent;
    const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
    const data = await this.fetchJSON(`${API_BASE}/me/media?fields=${fields}&access_token=${encode(token)}`);
    if (data.error) {
      throw new ProviderError(data.error.message || 'Instagram API error');
    }
    return data;
  }

  async getMediaInsights(token: string, mediaId: string): Promise<any> {
    const encode = encodeURIComponent;
    const metrics = 'views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time';
    const data = await this.fetchJSON(
      `${API_BASE}/${mediaId}/insights?metric=${metrics}&locale=en_US&access_token=${encode(token)}`,
    );
    if (data.error) {
      throw new ProviderError(data.error.message || 'Instagram API error');
    }
    return data;
  }

  async getAccountInsights(token: string, query: string): Promise<any> {
    const encode = encodeURIComponent;
    const userId = await this.getUserId(token);
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const until = Math.floor(Date.now() / 1000);
    const data = await this.fetchJSON(
      `${API_BASE}/${userId}/insights?${query}&since=${since}&until=${until}&locale=en_US&access_token=${encode(token)}`,
    );
    if (data.error) {
      throw new ProviderError(data.error.message || 'Instagram API error');
    }
    return data;
  }

  async getDemographicInsights(token: string, metric: string, breakdown: string): Promise<any> {
    const encode = encodeURIComponent;
    const userId = await this.getUserId(token);
    const data = await this.fetchJSON(
      `${API_BASE}/${userId}/insights?metric=${metric}&period=lifetime&timeframe=this_month&breakdown=${breakdown}&metric_type=total_value&locale=en_US&access_token=${encode(token)}`,
    );
    if (data.error) {
      throw new ProviderError(data.error.message || 'Instagram API error');
    }
    return data;
  }

  async getBasicProfile(token: string): Promise<{ username: string; followerCount: number }> {
    const encode = encodeURIComponent;
    try {
      const data = await this.fetchJSON(
        `${API_BASE}/me?fields=username,followers_count&access_token=${encode(token)}`,
      );
      return {
        username: data.username || 'unknown',
        followerCount: data.followers_count || 0,
      };
    } catch {
      return { username: 'unknown', followerCount: 0 };
    }
  }
}
