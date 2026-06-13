// ── Auth controller ──────────────────────────────────────────
// OAuth start, callback redirect, status polling, and logout.
// All routes are public — auth happens inside the OAuth flow.
//
// Flow:
//   1. GET /api/auth/start → { state, auth_url }. Client opens
//      auth_url (state travels to Instagram and back).
//   2. Instagram → GET /auth/callback?code&state. We exchange the
//      code, issue an influencer session, and either:
//      a. (Web new-tab) respond with an auto-close HTML page — the
//         original PWA tab picks up the session via polling.
//      b. (iOS PWA navigated / mobile) redirect back with
//         ?status=authenticated&session_id=<id>.
//   3. The client reads session_id from the redirect URL or poll.

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

  /// Returns a minimal HTML page that tries to close the OAuth popup/tab.
  ///
  /// Behaviour:
  /// - If the tab was opened via window.open() (new-tab flow), window.close()
  ///   succeeds and the tab disappears. The original PWA tab picks up the
  ///   session through its poll loop.
  /// - If the tab is the same window that navigated away (iOS PWA standalone
  ///   or popup-blocked), window.close() will fail. The page then redirects
  ///   to the PWA origin with the session params so the bootstrap can capture
  ///   the session on the next page load.
  private buildAutoClosePage(
    status: 'success' | 'error',
    options?: { message?: string; redirectUrl?: string },
  ): string {
    const { message, redirectUrl } = options ?? {};
    const title = status === 'success' ? 'Login Successful' : 'Login Failed';
    const body = status === 'success'
      ? 'You&#39;re logged in! This tab will close automatically&hellip;'
      : `Something went wrong: ${this.escapeHtml(message ?? 'Please try again.')}`;
    const icon = status === 'success' ? '&#10003;' : '&#10007;';
    const color = status === 'success' ? '#4CAF50' : '#e53935';

    // If we have a redirect URL, fallback to it when window.close() fails
    // (navigated-window case: iOS PWA standalone / popup blocked).
    const fallbackScript = redirectUrl
      ? `setTimeout(function() {
          document.getElementById('hint').style.display = 'block';
          // Redirect after a short delay to give window.close() a chance.
          setTimeout(function() { window.location.href = ${JSON.stringify(redirectUrl)}; }, 800);
        }, 300);`
      : `setTimeout(function() {
          document.getElementById('hint').style.display = 'block';
        }, 500);`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1A1035;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card { text-align: center; max-width: 360px; }
    .icon {
      width: 64px; height: 64px;
      border-radius: 50%;
      background: ${color};
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      margin-bottom: 16px;
    }
    h1 { font-size: 22px; margin-bottom: 8px; }
    p { font-size: 15px; opacity: 0.85; line-height: 1.5; }
    .hint { margin-top: 16px; font-size: 13px; opacity: 0.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <p class="hint" id="hint" style="display:none">Redirecting back to the app&hellip;</p>
  </div>
  <script>
    // Try to close immediately. Browsers allow window.close() on
    // windows that were opened by script (window.open).
    try { window.close(); } catch(e) {}
    ${fallbackScript}
  </script>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // GET /api/auth/start
  @Public()
  @Get('api/auth/start')
  async startOAuth(
    @Query('platform') platform?: string,
    @Query('web_redirect_uri') webRedirectUri?: string,
  ) {
    // Only pass a webUri for web clients. Mobile passes platform=mobile
    // to signal it wants the iginsights:// deep-link callback instead.
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

    // Determine if this OAuth tab was opened as a popup/new-tab from the PWA.
    // Only true for http/https URIs (web clients). Mobile passes iginsights://
    // as the redirect URI and expects a direct redirect, not an auto-close page.
    const isWebPopup = !!webUri && (webUri.startsWith('http://') || webUri.startsWith('https://'));

    if (error) {
      if (isWebPopup) {
        const redirectUrl = this.buildRedirectUrl(
          webUri,
          `status=error&reason=${encodeURIComponent(errorDescription || 'Authorization denied')}`,
        );
        return res
          .status(200)
          .header('Content-Type', 'text/html')
          .header('Content-Security-Policy', "script-src 'self' 'unsafe-inline'")
          .send(this.buildAutoClosePage('error', {
            message: errorDescription || 'Authorization denied',
            redirectUrl,
          }));
      }
      return res.redirect(
        this.buildRedirectUrl(
          webUri,
          `status=error&reason=${encodeURIComponent(errorDescription || 'Authorization denied')}`,
        ),
      );
    }

    if (!state || !oauthState) {
      if (isWebPopup) {
        return res
          .status(200)
          .header('Content-Type', 'text/html')
          .header('Content-Security-Policy', "script-src 'self' 'unsafe-inline'")
          .send(this.buildAutoClosePage('error', {
            message: 'Session expired. Please try again.',
          }));
      }
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
      if (isWebPopup) {
        const redirectUrl = this.buildRedirectUrl(
          webUri,
          `status=error&reason=${encodeURIComponent('Authentication failed')}`,
        );
        return res
          .status(200)
          .header('Content-Type', 'text/html')
          .header('Content-Security-Policy', "script-src 'self' 'unsafe-inline'")
          .send(this.buildAutoClosePage('error', {
            message: 'Authentication failed',
            redirectUrl,
          }));
      }
      return res.redirect(
        this.buildRedirectUrl(
          webUri,
          `status=error&reason=${encodeURIComponent('Authentication failed')}`,
        ),
      );
    }

    // Success!
    if (isWebPopup) {
      // Serve the auto-close page with CSP relaxed for inline script.
      // This is a transient server-generated page — not a user-facing
      // app surface — so unsafe-inline is acceptable here.
      const redirectUrl = this.buildRedirectUrl(
        webUri,
        `status=authenticated&session_id=${result.sessionId}`,
      );
      return res
        .status(200)
        .header('Content-Type', 'text/html')
        .header('Content-Security-Policy', "script-src 'self' 'unsafe-inline'")
        .send(this.buildAutoClosePage('success', { redirectUrl }));
    }

    // Mobile / iOS PWA navigated: redirect back with session in URL.
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
