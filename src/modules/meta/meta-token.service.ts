// ── Meta token service ───────────────────────────────────────
// Lazy refresh of Instagram long-lived access tokens.
//
// Meta's Instagram Graph API issues 60-day long-lived tokens that
// can be refreshed for another 60 days via
//   GET /refresh_access_token?grant_type=ig_refresh_token
// The token must be at least 24 hours old and not yet expired.
//
// Strategy: on every authenticated request we check whether the
// session's token is "close to expiring" (within the configured
// refresh window AND old enough to be refreshable). If so, we
// refresh in-line and update the session. This is cheap because
// the common case is a no-op check of two timestamps on an
// already-fetched session row.
//
// If a refresh fails with UnauthorizedError we mark the session
// as 'error' so the client is forced back through OAuth. Other
// errors are swallowed — the existing token is still valid, the
// next request will try again.

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { SessionService, SessionRecord } from '../../common/services/session.service';
import { AppError, AppErrorCode, UnauthorizedError } from '../../common/errors/app.errors';
import { MetaService } from './meta.service';

@Injectable()
export class MetaTokenService {
  private readonly logger = new Logger(MetaTokenService.name);

  // Coalesce concurrent refresh attempts for the same session so we
  // don't fire two refresh calls in parallel on a busy login.
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly sessionService: SessionService,
    private readonly metaService: MetaService,
  ) {}

  /**
   * Given the current session, return an access token that is safe
   * to use right now. If the token is near expiry and refreshable,
   * refresh it and persist the new value. Returns the (possibly
   * updated) plaintext token.
   *
   * Throws UnauthorizedError if the token is already dead and
   * cannot be refreshed — caller (auth guard) should 401.
   */
  async ensureFreshToken(session: SessionRecord): Promise<string> {
    if (!session.accessToken) {
      throw new UnauthorizedError('Not authenticated');
    }

    const now = Date.now();
    const tokenExpiresAt = session.tokenExpiresAt?.getTime() ?? null;

    // If we know the token is already dead, don't bother hitting Meta.
    if (tokenExpiresAt !== null && tokenExpiresAt <= now) {
      this.logger.warn(
        `Session ${session.sessionId} token expired at ${session.tokenExpiresAt?.toISOString()}`,
      );
      await this.sessionService.invalidateByProviderUserId(
        session.providerUserId || '__noop__',
      );
      throw new UnauthorizedError('Instagram session expired');
    }

    if (!this.shouldRefresh(session, now)) {
      return session.accessToken;
    }

    return this.refresh(session);
  }

  /**
   * Should we proactively refresh this token right now?
   *
   *   1. We must know when it expires (tokenExpiresAt set).
   *   2. It must be within the refresh window (default 7 days).
   *   3. The token must be at least 24h old (Meta requirement),
   *      measured from either lastRefreshedAt or createdAt.
   */
  private shouldRefresh(session: SessionRecord, now: number): boolean {
    const expiresAt = session.tokenExpiresAt?.getTime();
    if (expiresAt == null) return false;

    const withinWindow = expiresAt - now <= env.instagramTokenRefreshWindowMs;
    if (!withinWindow) return false;

    const lastRefreshOrCreate =
      session.lastRefreshedAt?.getTime() ?? session.createdAt.getTime();
    const oldEnough = now - lastRefreshOrCreate >= env.instagramTokenMinAgeForRefreshMs;
    return oldEnough;
  }

  private refresh(session: SessionRecord): Promise<string> {
    const existing = this.inflight.get(session.sessionId);
    if (existing) return existing;

    const promise = this.doRefresh(session).finally(() => {
      this.inflight.delete(session.sessionId);
    });
    this.inflight.set(session.sessionId, promise);
    return promise;
  }

  private async doRefresh(session: SessionRecord): Promise<string> {
    const currentToken = session.accessToken!;
    try {
      this.logger.log(
        `Refreshing IG token for session=${session.sessionId} ` +
          `(expires ${session.tokenExpiresAt?.toISOString() ?? 'unknown'})`,
      );
      const { accessToken, expiresIn } =
        await this.metaService.refreshLongLivedToken(currentToken);

      const ttlMs =
        expiresIn != null ? expiresIn * 1000 : env.instagramLongLivedTokenTtlMs;
      const tokenExpiresAt = new Date(Date.now() + ttlMs);

      await this.sessionService.update(session.sessionId, {
        accessToken,
        tokenExpiresAt,
        lastRefreshedAt: new Date(),
        // Active user — keep the session alive too.
        rollExpiresAt: true,
      });

      this.logger.log(
        `IG token refreshed for session=${session.sessionId} (new expiry ${tokenExpiresAt.toISOString()})`,
      );
      return accessToken;
    } catch (err) {
      if (err instanceof AppError && err.code === AppErrorCode.UNAUTHORIZED) {
        // Token is gone — invalidate so the client re-auths.
        if (session.providerUserId) {
          await this.sessionService.invalidateByProviderUserId(session.providerUserId);
        } else {
          await this.sessionService.update(session.sessionId, {
            status: 'error',
            accessToken: null,
          });
        }
        throw err;
      }
      // Transient failure — log and return the existing token. It
      // is still valid; we'll retry on the next request.
      this.logger.warn(
        `IG token refresh failed for session=${session.sessionId}: ${(err as Error).message}. ` +
          `Continuing with current token.`,
      );
      return currentToken;
    }
  }
}
