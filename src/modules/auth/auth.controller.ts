// ── Auth controller ──────────────────────────────────────────
// Handles OAuth start, callback redirect, status polling, and logout.
// All routes are public — auth happens inside the OAuth flow itself.

import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SessionService } from '../../common/services/session.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  /// Build the post-callback redirect URL.
  ///
  /// Web clients pass `web_redirect_uri` to /api/auth/start; we persist
  /// it on the session row (see sessions.web_redirect_uri column) so
  /// the callback works regardless of which Railway replica handles
  /// the request and whether the server has been restarted in between.
  /// Mobile clients fall through to the custom `iginsights://` scheme.
  private buildRedirectUrl(webUri: string | null, params: string): string {
    if (webUri) {
      const separator = webUri.includes('?') ? '&' : '?';
      return `${webUri}${separator}${params}`;
    }
    return `iginsights://auth?${params}`;
  }

  // GET /api/auth/start
  @Public()
  @Get('api/auth/start')
  async startOAuth(
    @Query('platform') platform?: string,
    @Query('web_redirect_uri') webRedirectUri?: string,
  ) {
    const { sessionId, authUrl } = await this.authService.startOAuth();
    if (platform === 'web' && webRedirectUri) {
      // Persist on the session row so the callback (potentially on a
      // different replica or after a restart) can rebuild the URL.
      await this.sessionService.update(sessionId, {
        webRedirectUri,
      });
    }
    return { session_id: sessionId, auth_url: authUrl };
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
    const session = state ? await this.sessionService.get(state) : null;
    const webUri = session?.webRedirectUri ?? null;

    if (error) {
      return res.redirect(
        this.buildRedirectUrl(
          webUri,
          `status=error&session_id=${state}&reason=${encodeURIComponent(errorDescription || 'Authorization denied')}`,
        ),
      );
    }

    if (!state) {
      return res.redirect(
        this.buildRedirectUrl(
          null,
          `status=error&reason=${encodeURIComponent('Session expired. Please try again.')}`,
        ),
      );
    }

    if (!session) {
      return res.redirect(
        this.buildRedirectUrl(
          null,
          `status=error&reason=${encodeURIComponent('Session expired. Please try again.')}`,
        ),
      );
    }

    const code = (rawCode || '').replace(/#_$/, '');
    const result = await this.authService.handleCallback(code, state);

    if (result.status === 'error') {
      return res.redirect(
        this.buildRedirectUrl(
          webUri,
          `status=error&session_id=${state}&reason=${encodeURIComponent('Authentication failed')}`,
        ),
      );
    }

    return res.redirect(
      this.buildRedirectUrl(
        webUri,
        `status=authenticated&session_id=${state}`,
      ),
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
