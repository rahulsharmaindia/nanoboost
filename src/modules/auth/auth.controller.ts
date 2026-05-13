// ── Auth controller ──────────────────────────────────────────
// Handles OAuth start, callback redirect, status polling, and logout.
// All routes are public — auth happens inside the OAuth flow itself.

import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /// In-memory map of sessionId → web redirect URI.
  /// Populated when a web client starts OAuth, consumed in the callback.
  /// This avoids a DB schema change — the entry lives only for the
  /// duration of the OAuth flow (seconds to minutes).
  private webRedirects = new Map<string, string>();

  private buildRedirectUrl(sessionId: string, params: string): string {
    const webUri = this.webRedirects.get(sessionId);
    if (webUri) {
      this.webRedirects.delete(sessionId);
      // Redirect back to the PWA with query params
      const separator = webUri.includes('?') ? '&' : '?';
      return `${webUri}${separator}${params}`;
    }
    // Mobile: use custom scheme
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
    // Store the web redirect URI so the callback knows where to send
    // the user back to after OAuth completes.
    if (platform === 'web' && webRedirectUri) {
      this.webRedirects.set(sessionId, webRedirectUri);
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
    if (error) {
      return res.redirect(
        this.buildRedirectUrl(state || '', `status=error&session_id=${state}&reason=${encodeURIComponent(errorDescription || 'Authorization denied')}`),
      );
    }

    if (!state) {
      return res.redirect(
        this.buildRedirectUrl('', `status=error&reason=${encodeURIComponent('Session expired. Please try again.')}`),
      );
    }

    const existing = await this.authService.getStatus(state);
    if (existing.status === 'not_found') {
      return res.redirect(
        this.buildRedirectUrl(state, `status=error&reason=${encodeURIComponent('Session expired. Please try again.')}`),
      );
    }

    const code = (rawCode || '').replace(/#_$/, '');
    const result = await this.authService.handleCallback(code, state);

    if (result.status === 'error') {
      return res.redirect(
        this.buildRedirectUrl(state, `status=error&session_id=${state}&reason=${encodeURIComponent('Authentication failed')}`),
      );
    }

    return res.redirect(
      this.buildRedirectUrl(state, `status=authenticated&session_id=${state}`),
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
