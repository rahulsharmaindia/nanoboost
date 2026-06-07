// ── Auth controller ──────────────────────────────────────────
// OAuth start, callback redirect, status polling, and logout.
// All routes are public — auth happens inside the OAuth flow.
//
// Flow:
//   1. GET /api/auth/start → { state, auth_url }. Client opens
//      auth_url (state travels to Instagram and back).
//   2. Instagram → GET /auth/callback?code&state. We exchange the
//      code, issue an influencer session, and redirect back to the
//      app with ?status=authenticated&session_id=<id>.
//   3. The client reads session_id from the redirect URL.

import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { InfluencerSessionService } from '../../common/services/influencer-session.service';
import { Public } from '../../common/decorators/public.decorator';
import { env } from '../../config/env';

@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: InfluencerSessionService,
  ) {}

  private buildRedirectUrl(webUri: string | null, params: string): string {
    const target = webUri ?? env.webFallbackUri ?? null;
    if (target) {
      const separator = target.includes('?') ? '&' : '?';
      return `${target}${separator}${params}`;
    }
    this.logger.warn(
      'OAuth callback falling back to iginsights:// — set WEB_FALLBACK_URI to the PWA origin.',
    );
    return `iginsights://auth?${params}`;
  }

  // GET /api/auth/start
  @Public()
  @Get('api/auth/start')
  async startOAuth(
    @Query('platform') platform?: string,
    @Query('web_redirect_uri') webRedirectUri?: string,
  ) {
    const webUri = platform === 'web' && webRedirectUri ? webRedirectUri : null;
    const { state, pollToken, authUrl } = await this.authService.startOAuth(webUri);
    return { state, poll_token: pollToken, auth_url: authUrl };
  }

  // GET /api/auth/poll?poll_token=...
  // Fallback for environments where the redirect-back is unreliable
  // (e.g. iOS PWA standalone). The poll token is private to the client
  // and never travels to Instagram. Single-use.
  @Public()
  @Get('api/auth/poll')
  async pollAuth(@Query('poll_token') pollToken: string) {
    if (!pollToken) {
      return { status: 'not_found' };
    }
    const result = await this.authService.pollAuth(pollToken);
    return { status: result.status, session_id: result.sessionId ?? null };
  }

  // GET /auth/callback  (Instagram redirects here)
  @Public()
  @Get('auth/callback')
  async handleCallback(
    @Query('code') rawCode: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const oauthState = state ? await this.sessionService.getOAuthState(state) : null;
    const webUri = oauthState?.webRedirectUri ?? null;

    if (error) {
      return res.redirect(
        this.buildRedirectUrl(
          webUri,
          `status=error&reason=${encodeURIComponent(errorDescription || 'Authorization denied')}`,
        ),
      );
    }

    if (!state || !oauthState) {
      return res.redirect(
        this.buildRedirectUrl(
          null,
          `status=error&reason=${encodeURIComponent('Session expired. Please try again.')}`,
        ),
      );
    }

    const code = (rawCode || '').replace(/#_$/, '');
    const result = await this.authService.handleCallback(code, state);

    if (result.status === 'error' || !result.sessionId) {
      return res.redirect(
        this.buildRedirectUrl(
          webUri,
          `status=error&reason=${encodeURIComponent('Authentication failed')}`,
        ),
      );
    }

    return res.redirect(
      this.buildRedirectUrl(webUri, `status=authenticated&session_id=${result.sessionId}`),
    );
  }

  // GET /api/auth/status
  @Public()
  @Get('api/auth/status')
  async getStatus(@Query('session_id') sessionId: string) {
    if (!sessionId) {
      return { status: 'not_found' };
    }
    const { status, userId } = await this.authService.getStatus(sessionId);
    return { status, user_id: userId };
  }

  // GET /api/auth/logout
  @Public()
  @Get('api/auth/logout')
  async logout(@Req() req: Request) {
    const sessionId =
      req.headers['authorization']?.replace('Bearer ', '') ||
      (req.query.session_id as string);
    if (sessionId) {
      await this.authService.logout(sessionId);
    }
    return { status: 'logged_out' };
  }
}
