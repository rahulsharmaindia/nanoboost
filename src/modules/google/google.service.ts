// ── Google service ───────────────────────────────────────────
// All outbound calls to Google's OAuth / OpenID Connect endpoints
// live here, exactly as MetaService isolates the Meta Graph API.
//
// It never logs tokens and never returns raw tokens to the
// controller — it returns only the resolved { googleUserId, email }.
// Any failure is surfaced as a ProviderError so the caller issues
// no session.

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { ProviderError } from '../../common/errors/app.errors';

export interface GoogleIdentity {
  googleUserId: string; // Google account id (the `sub` claim)
  email: string | null;
}

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);

  /** Build the Google consent URL from the app's own OAuth client creds. */
  buildAuthUrl(state: string): string {
    const encode = encodeURIComponent;
    return (
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encode(env.googleClientId)}` +
      `&redirect_uri=${encode(env.googleRedirectUri)}` +
      `&response_type=code` +
      `&scope=${encode(env.googleScopes)}` +
      `&state=${state}` +
      `&access_type=offline&prompt=consent`
    );
  }

  /**
   * Exchange an authorization code for tokens using the app's own
   * Google OAuth client credentials, then resolve the account id +
   * email from the userinfo endpoint (or by decoding the id_token).
   * Throws ProviderError on any failure so the caller issues no session.
   */
  async exchangeCodeForIdentity(code: string): Promise<GoogleIdentity> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: env.googleRedirectUri,
        grant_type: 'authorization_code',
        code,
      }).toString(),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || token.error || !token.access_token) {
      throw new ProviderError(
        token.error_description || 'Google code exchange failed',
      );
    }

    // Prefer the userinfo endpoint; the id_token can also be decoded
    // for `sub`/`email`.
    const infoRes = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
      },
    );
    const info = await infoRes.json();
    if (!infoRes.ok || info.error || !info.sub) {
      throw new ProviderError('Failed to retrieve Google account identity');
    }
    return { googleUserId: String(info.sub), email: info.email ?? null };
  }
}
