// ── Auth service ─────────────────────────────────────────────
// Instagram OAuth flow for influencers. The handshake `state` is
// stored in influencer_oauth_states; on a successful callback the
// influencer + social account are upserted and a session issued.

import { Injectable, Logger } from '@nestjs/common';
import { InfluencerSessionService } from '../../common/services/influencer-session.service';
import { MetaService } from '../meta/meta.service';
import { env } from '../../config/env';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly sessionService: InfluencerSessionService,
    private readonly metaService: MetaService,
  ) {}

  async startOAuth(
    webRedirectUri?: string | null,
  ): Promise<{ state: string; pollToken: string; authUrl: string }> {
    const { state, pollToken } = await this.sessionService.createOAuthState(webRedirectUri);

    const encode = encodeURIComponent;
    const authUrl =
      'https://www.instagram.com/oauth/authorize' +
      `?client_id=${env.instagramAppId}` +
      `&redirect_uri=${encode(env.redirectUri)}` +
      `&response_type=code` +
      `&scope=${encode(env.instagramScopes)}` +
      `&state=${state}`;

    this.logger.log(`OAuth state created: ${state}`);
    return { state, pollToken, authUrl };
  }

  // Returns the issued session id on success, or null on failure.
  async handleCallback(code: string, state: string): Promise<{ status: string; sessionId: string | null }> {
    const oauthState = await this.sessionService.getOAuthState(state);
    if (!oauthState) {
      return { status: 'error', sessionId: null };
    }

    try {
      const tokenData = await this.metaService.exchangeCodeForToken(code);
      if (tokenData.error_message) {
        await this.sessionService.markStateError(state);
        return { status: 'error', sessionId: null };
      }

      const shortLivedToken = tokenData.data
        ? tokenData.data[0].access_token
        : tokenData.access_token;
      const userId = tokenData.data ? tokenData.data[0].user_id : tokenData.user_id;

      const { accessToken, expiresIn } =
        await this.metaService.exchangeForLongLivedToken(shortLivedToken);

      const ttlMs = expiresIn != null ? expiresIn * 1000 : env.instagramLongLivedTokenTtlMs;
      const tokenExpiresAt = new Date(Date.now() + ttlMs);

      const sessionId = await this.sessionService.completeOAuth({
        instagramUserId: String(userId),
        accessToken,
        tokenExpiresAt,
      });

      // Keep the handshake row so the poll fallback can deliver the
      // session id to the client; it's consumed on poll or expiry.
      await this.sessionService.attachSessionToState(state, sessionId);
      this.logger.log(`Authenticated influencer (ig user ${userId})`);
      return { status: 'authenticated', sessionId };
    } catch (err) {
      await this.sessionService.markStateError(state);
      this.logger.error(`OAuth callback failed: ${(err as Error).message}`);
      return { status: 'error', sessionId: null };
    }
  }

  // Poll fallback — exchange the private poll token for the session.
  async pollAuth(
    pollToken: string,
  ): Promise<{ status: string; sessionId?: string }> {
    return this.sessionService.pollByToken(pollToken);
  }

  async getStatus(sessionId: string): Promise<{ status: string; userId: string | null }> {
    const session = await this.sessionService.getSession(sessionId);
    if (!session) {
      return { status: 'not_found', userId: null };
    }
    return { status: 'authenticated', userId: session.instagramUserId };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.remove(sessionId);
  }
}
