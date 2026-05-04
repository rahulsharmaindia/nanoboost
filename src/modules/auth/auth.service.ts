// ── Auth service ─────────────────────────────────────────────
// Handles Instagram OAuth flow: session creation, token exchange,
// status polling, and logout.

import { Injectable, Logger } from '@nestjs/common';
import { SessionService } from '../../common/services/session.service';
import { MetaService } from '../meta/meta.service';
import { env } from '../../config/env';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly metaService: MetaService,
  ) {}

  startOAuth(): { sessionId: string; authUrl: string } {
    const sessionId = this.sessionService.create();

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
    const session = this.sessionService.get(state);
    if (!session) {
      return { status: 'error', sessionId: state };
    }

    try {
      const tokenData = await this.metaService.exchangeCodeForToken(code);

      if (tokenData.error_message) {
        session.status = 'error';
        return { status: 'error', sessionId: state };
      }

      const accessToken = tokenData.data
        ? tokenData.data[0].access_token
        : tokenData.access_token;
      const userId = tokenData.data
        ? tokenData.data[0].user_id
        : tokenData.user_id;

      session.accessToken = accessToken;
      session.userId = userId;
      session.status = 'authenticated';

      this.logger.log(`Authenticated user ${userId}`);
      return { status: 'authenticated', sessionId: state };
    } catch (err) {
      session.status = 'error';
      this.logger.error(`OAuth callback failed: ${(err as Error).message}`);
      return { status: 'error', sessionId: state };
    }
  }

  getStatus(sessionId: string): { status: string; userId: string | null } {
    const session = this.sessionService.get(sessionId);
    if (!session) {
      return { status: 'not_found', userId: null };
    }
    return { status: session.status, userId: session.userId };
  }

  logout(sessionId: string): void {
    this.sessionService.remove(sessionId);
  }
}
