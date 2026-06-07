// ── Meta token service ───────────────────────────────────────
// Lazy refresh of Instagram long-lived access tokens.
//
// Meta issues 60-day long-lived tokens, refreshable for another
// 60 days via GET /refresh_access_token. The token must be at
// least 24h old and not yet expired.
//
// On every authenticated request we check whether the influencer's
// token is close to expiry (within the refresh window AND old
// enough). If so we refresh in-line and persist the new value on
// the social account. The common case is a cheap timestamp check.

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import {
  InfluencerSessionService,
  InfluencerContext,
} from '../../common/services/influencer-session.service';
import { AppError, AppErrorCode, UnauthorizedError } from '../../common/errors/app.errors';
import { MetaService } from './meta.service';

@Injectable()
export class MetaTokenService {
  private readonly logger = new Logger(MetaTokenService.name);

  // Coalesce concurrent refreshes for the same session.
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly sessionService: InfluencerSessionService,
    private readonly metaService: MetaService,
  ) {}

  async ensureFreshToken(session: InfluencerContext): Promise<string> {
    if (!session.accessToken) {
      throw new UnauthorizedError('Not authenticated');
    }

    const now = Date.now();
    const tokenExpiresAt = session.tokenExpiresAt?.getTime() ?? null;

    if (tokenExpiresAt !== null && tokenExpiresAt <= now) {
      this.logger.warn(
        `Influencer ${session.influencerId} token expired at ${session.tokenExpiresAt?.toISOString()}`,
      );
      await this.sessionService.disconnect(session.influencerId);
      throw new UnauthorizedError('Instagram session expired');
    }

    if (!this.shouldRefresh(session, now)) {
      return session.accessToken;
    }

    return this.refresh(session);
  }

  private shouldRefresh(session: InfluencerContext, now: number): boolean {
    const expiresAt = session.tokenExpiresAt?.getTime();
    if (expiresAt == null) return false;

    const withinWindow = expiresAt - now <= env.instagramTokenRefreshWindowMs;
    if (!withinWindow) return false;

    const lastRefreshOrCreate =
      session.lastRefreshedAt?.getTime() ??
      session.socialConnectedAt?.getTime() ??
      session.sessionCreatedAt.getTime();
    return now - lastRefreshOrCreate >= env.instagramTokenMinAgeForRefreshMs;
  }

  private refresh(session: InfluencerContext): Promise<string> {
    const existing = this.inflight.get(session.sessionId);
    if (existing) return existing;

    const promise = this.doRefresh(session).finally(() => {
      this.inflight.delete(session.sessionId);
    });
    this.inflight.set(session.sessionId, promise);
    return promise;
  }

  private async doRefresh(session: InfluencerContext): Promise<string> {
    const currentToken = session.accessToken!;
    try {
      this.logger.log(
        `Refreshing IG token for influencer=${session.influencerId} ` +
          `(expires ${session.tokenExpiresAt?.toISOString() ?? 'unknown'})`,
      );
      const { accessToken, expiresIn } =
        await this.metaService.refreshLongLivedToken(currentToken);

      const ttlMs =
        expiresIn != null ? expiresIn * 1000 : env.instagramLongLivedTokenTtlMs;
      const tokenExpiresAt = new Date(Date.now() + ttlMs);

      await this.sessionService.updateToken(session.influencerId, {
        accessToken,
        tokenExpiresAt,
        lastRefreshedAt: new Date(),
      });
      await this.sessionService.rollSessionExpiry(session.sessionId);

      this.logger.log(
        `IG token refreshed for influencer=${session.influencerId} (new expiry ${tokenExpiresAt.toISOString()})`,
      );
      return accessToken;
    } catch (err) {
      if (err instanceof AppError && err.code === AppErrorCode.UNAUTHORIZED) {
        await this.sessionService.disconnect(session.influencerId);
        throw err;
      }
      this.logger.warn(
        `IG token refresh failed for influencer=${session.influencerId}: ${(err as Error).message}. ` +
          `Continuing with current token.`,
      );
      return currentToken;
    }
  }
}
