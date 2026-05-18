// ── Auth service ─────────────────────────────────────────────
// Handles Instagram OAuth flow: session creation, token exchange,
// status polling, and logout. Sessions are persisted in the
// database (see sessions table / SessionService).

import { Injectable, Logger } from '@nestjs/common';
import { SessionService } from '../../common/services/session.service';
import { MetaService } from '../meta/meta.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { env } from '../../config/env';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly metaService: MetaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async startOAuth(): Promise<{ sessionId: string; authUrl: string }> {
    const sessionId = await this.sessionService.create({ status: 'pending' });

    const encode = encodeURIComponent;
    const authUrl =
      'https://www.instagram.com/oauth/authorize' +
      `?client_id=${env.instagramAppId}` +
      `&redirect_uri=${encode(env.redirectUri)}` +
      `&response_type=code` +
      `&scope=${encode(env.instagramScopes)}` +
      `&state=${sessionId}`;

    this.logger.log(`Session created: ${sessionId}`);
    return { sessionId, authUrl };
  }

  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ status: string; sessionId: string }> {
    const session = await this.sessionService.get(state);
    if (!session) {
      return { status: 'error', sessionId: state };
    }

    try {
      const tokenData = await this.metaService.exchangeCodeForToken(code);

      if (tokenData.error_message) {
        await this.sessionService.update(state, { status: 'error' });
        return { status: 'error', sessionId: state };
      }

      const shortLivedToken = tokenData.data
        ? tokenData.data[0].access_token
        : tokenData.access_token;
      const userId = tokenData.data
        ? tokenData.data[0].user_id
        : tokenData.user_id;

      // Exchange for long-lived token (60 days). We capture the exact
      // `expires_in` so the session's tokenExpiresAt matches Meta's
      // view of the world; if Meta didn't return it we fall back to
      // the documented 60-day default.
      const { accessToken, expiresIn } =
        await this.metaService.exchangeForLongLivedToken(shortLivedToken);

      const ttlMs =
        expiresIn != null ? expiresIn * 1000 : env.instagramLongLivedTokenTtlMs;
      const tokenExpiresAt = new Date(Date.now() + ttlMs);

      await this.sessionService.update(state, {
        accessToken,
        providerUserId: String(userId),
        status: 'authenticated',
        tokenExpiresAt,
        // Session TTL already matches the token TTL (60d in env).
        // Roll forward so the clock starts from successful login.
        rollExpiresAt: true,
      });

      // Provision a creator-tier subscription for this user (Req 17.5, 17.6).
      // createForNewUser is idempotent — returning users get their existing
      // subscription back. If provisioning fails for a new user, the error
      // propagates and signup is reported as failed (Req 17.6).
      await this.subscriptionsService.createForNewUser(String(userId));

      this.logger.log(`Authenticated user ${userId}`);
      return { status: 'authenticated', sessionId: state };
    } catch (err) {
      await this.sessionService.update(state, { status: 'error' });
      this.logger.error(`OAuth callback failed: ${(err as Error).message}`);
      return { status: 'error', sessionId: state };
    }
  }

  async getStatus(sessionId: string): Promise<{ status: string; userId: string | null }> {
    const session = await this.sessionService.get(sessionId);
    if (!session) {
      return { status: 'not_found', userId: null };
    }
    return { status: session.status, userId: session.providerUserId };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.remove(sessionId);
  }
}
