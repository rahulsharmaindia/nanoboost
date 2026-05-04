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

  // GET /api/auth/start
  @Public()
  @Get('api/auth/start')
  startOAuth() {
    const { sessionId, authUrl } = this.authService.startOAuth();
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
        `iginsights://auth?status=error&session_id=${state}&reason=${encodeURIComponent(errorDescription || 'Authorization denied')}`,
      );
    }

    if (!state || !this.authService.getStatus(state).status || this.authService.getStatus(state).status === 'not_found') {
      return res.redirect(
        `iginsights://auth?status=error&reason=${encodeURIComponent('Session expired. Please try again.')}`,
      );
    }

    const code = (rawCode || '').replace(/#_$/, '');
    const result = await this.authService.handleCallback(code, state);

    if (result.status === 'error') {
      return res.redirect(
        `iginsights://auth?status=error&session_id=${state}&reason=${encodeURIComponent('Authentication failed')}`,
      );
    }

    return res.redirect(`iginsights://auth?status=authenticated&session_id=${state}`);
  }

  // GET /api/auth/status
  @Public()
  @Get('api/auth/status')
  getStatus(@Query('session_id') sessionId: string) {
    if (!sessionId) {
      return { status: 'not_found' };
    }
    const { status, userId } = this.authService.getStatus(sessionId);
    return { status, user_id: userId };
  }

  // GET /api/auth/logout
  @Public()
  @Get('api/auth/logout')
  logout(@Req() req: Request) {
    const sessionId =
      req.headers['authorization']?.replace('Bearer ', '') ||
      (req.query.session_id as string);

    if (sessionId) {
      this.authService.logout(sessionId);
    }
    return { status: 'logged_out' };
  }
}
