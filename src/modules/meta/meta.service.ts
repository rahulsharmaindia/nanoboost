// ── Meta service ─────────────────────────────────────────────
// All outbound calls to the Instagram/Meta Graph API live here.
// Never logs tokens. Never returns raw tokens to controllers.
//
// Error handling: any Graph API response that indicates the
// access token has been revoked, expired, or had its permissions
// withdrawn is translated into a typed AppError. The caller (auth
// guard or service) is responsible for invalidating the local
// session record when it sees one of these.

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import {
  AppError,
  AppErrorCode,
  ProviderError,
  UnauthorizedError,
} from '../../common/errors/app.errors';

const API_BASE = `https://graph.instagram.com/${env.instagramApiVersion}`;

/**
 * Meta Graph API error codes that indicate the token is no longer
 * usable. We surface these as UnauthorizedError so the caller can
 * clear the session and force a re-login.
 *
 *   190              → OAuthException (token invalid / expired / revoked)
 *   subcodes 458/459 → App not installed / user logged out
 *   subcodes 463/467 → Token expired / malformed
 *   subcodes 490     → Password changed
 *   102              → Session key invalid
 */
const TOKEN_DEAD_CODES = new Set<number>([190, 102]);
const TOKEN_DEAD_SUBCODES = new Set<number>([458, 459, 460, 463, 467, 490]);

function isTokenDeadError(err: any): boolean {
  if (!err) return false;
  const code = Number(err.code);
  const sub = Number(err.error_subcode ?? err.subcode ?? 0);
  if (TOKEN_DEAD_CODES.has(code)) return true;
  if (TOKEN_DEAD_SUBCODES.has(sub)) return true;
  // Meta sometimes returns error.type === 'OAuthException' without
  // a subcode; treat those as token-dead by default.
  if (String(err.type || '').includes('OAuth')) return true;
  return false;
}

export interface LongLivedTokenResult {
  accessToken: string;
  // Seconds until expiry as reported by Meta. null if Meta didn't
  // return expires_in (e.g. short-lived-fallback path).
  expiresIn: number | null;
}

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

  /**
   * Inspect a Graph API response. If it indicates the token is
   * dead, throw UnauthorizedError so callers can invalidate the
   * session. Any other error becomes a generic ProviderError.
   */
  private assertOk(data: any): void {
    if (!data || !data.error) return;
    if (isTokenDeadError(data.error)) {
      throw new UnauthorizedError(
        data.error.message || 'Instagram token is no longer valid',
      );
    }
    throw new ProviderError(data.error.message || 'Instagram API error');
  }

  // ── OAuth token lifecycle ──────────────────────────────────

  async exchangeCodeForToken(code: string): Promise<any> {
    return this.postForm('https://api.instagram.com/oauth/access_token', {
      client_id: env.instagramAppId,
      client_secret: env.instagramAppSecret,
      grant_type: 'authorization_code',
      redirect_uri: env.redirectUri,
      code,
    });
  }

  /**
   * Exchange a short-lived token (1h) for a long-lived token (60d).
   * Returns the new token plus the exact `expires_in` Meta reports
   * so callers can persist a precise `tokenExpiresAt`.
   *
   * If the exchange fails for any reason we fall back to the
   * short-lived token with `expiresIn = null`, matching prior
   * behaviour. The login still succeeds; the guard will refresh
   * or reauth on the next use.
   */
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<LongLivedTokenResult> {
    const encode = encodeURIComponent;
    try {
      const data = await this.fetchJSON(
        `${API_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${encode(env.instagramAppSecret)}&access_token=${encode(shortLivedToken)}`,
      );
      if (data.access_token) {
        this.logger.log(`Long-lived token obtained (expires in ${data.expires_in}s)`);
        return {
          accessToken: data.access_token,
          expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
        };
      }
      this.logger.warn('Long-lived token exchange failed, using short-lived token');
      return { accessToken: shortLivedToken, expiresIn: null };
    } catch (err) {
      this.logger.warn(`Long-lived token exchange error: ${(err as Error).message}`);
      return { accessToken: shortLivedToken, expiresIn: null };
    }
  }

  /**
   * Refresh an existing long-lived token. Per Meta docs the token
   * must be at least 24 hours old and not yet expired. On success
   * the new token is also long-lived (another 60 days from now).
   *
   * Throws UnauthorizedError if the refresh is rejected because
   * the token is no longer valid.
   */
  async refreshLongLivedToken(currentToken: string): Promise<LongLivedTokenResult> {
    const encode = encodeURIComponent;
    const data = await this.fetchJSON(
      `${API_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encode(currentToken)}`,
    );
    if (data && data.error) {
      if (isTokenDeadError(data.error)) {
        throw new UnauthorizedError(
          data.error.message || 'Instagram token cannot be refreshed',
        );
      }
      throw new ProviderError(data.error.message || 'Token refresh failed');
    }
    if (!data?.access_token) {
      throw new ProviderError('Token refresh response missing access_token');
    }
    return {
      accessToken: data.access_token,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
    };
  }

  // ── Graph API reads ────────────────────────────────────────

  async getUserId(token: string): Promise<string> {
    const encode = encodeURIComponent;
    const me = await this.fetchJSON(`${API_BASE}/me?fields=user_id&access_token=${encode(token)}`);
    this.assertOk(me);
    return me.user_id || me.id;
  }

  async getUserProfile(token: string): Promise<any> {
    const encode = encodeURIComponent;
    const fields = 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography';
    const data = await this.fetchJSON(`${API_BASE}/me?fields=${fields}&access_token=${encode(token)}`);
    this.assertOk(data);
    return data;
  }

  async getUserMedia(token: string): Promise<any> {
    const encode = encodeURIComponent;
    const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
    const data = await this.fetchJSON(`${API_BASE}/me/media?fields=${fields}&access_token=${encode(token)}`);
    this.assertOk(data);
    return data;
  }

  async getMediaInsights(token: string, mediaId: string): Promise<any> {
    const encode = encodeURIComponent;
    const metrics = 'views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time';
    const data = await this.fetchJSON(
      `${API_BASE}/${mediaId}/insights?metric=${metrics}&locale=en_US&access_token=${encode(token)}`,
    );
    this.assertOk(data);
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
    this.assertOk(data);
    return data;
  }

  async getDemographicInsights(token: string, metric: string, breakdown: string): Promise<any> {
    const encode = encodeURIComponent;
    const userId = await this.getUserId(token);
    const data = await this.fetchJSON(
      `${API_BASE}/${userId}/insights?metric=${metric}&period=lifetime&timeframe=this_month&breakdown=${breakdown}&metric_type=total_value&locale=en_US&access_token=${encode(token)}`,
    );
    this.assertOk(data);
    return data;
  }

  async getBasicProfile(token: string): Promise<{ username: string; followerCount: number }> {
    const encode = encodeURIComponent;
    try {
      const data = await this.fetchJSON(
        `${API_BASE}/me?fields=username,followers_count&access_token=${encode(token)}`,
      );
      // Propagate token-dead errors; swallow other failures so
      // non-critical lookups degrade gracefully.
      if (data?.error && isTokenDeadError(data.error)) {
        throw new UnauthorizedError(data.error.message || 'Instagram token invalid');
      }
      return {
        username: data.username || 'unknown',
        followerCount: data.followers_count || 0,
      };
    } catch (err) {
      if (err instanceof AppError && err.code === AppErrorCode.UNAUTHORIZED) throw err;
      return { username: 'unknown', followerCount: 0 };
    }
  }
}
