// ── Influencer auth guard ────────────────────────────────────
// Validates an influencer session token (Authorization header or
// session_id query param). A valid session alone authorizes the
// request — Google-only influencers have no Instagram token. When an
// Instagram token is present it is lazily refreshed; the resulting
// context is attached for downstream handlers. @Public() routes bypass.

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { InfluencerSessionService } from '../services/influencer-session.service';
import { MetaTokenService } from '../../modules/meta/meta-token.service';
import { UnauthorizedError } from '../errors/app.errors';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: InfluencerSessionService,
    private readonly metaTokenService: MetaTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const sessionId =
      request.headers['authorization']?.replace('Bearer ', '') ||
      request.query.session_id;

    if (!sessionId) {
      throw new UnauthorizedError('Not authenticated');
    }

    const session = await this.sessionService.getSession(sessionId);
    if (!session) {
      throw new UnauthorizedError('Not authenticated');
    }

    // A valid session alone authorizes the request. Google-only
    // influencers have no Instagram social account / access token, so
    // only run the lazy IG long-lived token refresh when a token is
    // actually present; otherwise leave the access token null.
    const accessToken = session.accessToken
      ? await this.metaTokenService.ensureFreshToken(session)
      : null;

    request.accessToken = accessToken;
    request.sessionId = sessionId;
    request.influencerId = session.influencerId;
    request.providerUserId = session.instagramUserId;
    request.user = {
      sessionId,
      influencerId: session.influencerId,
      userId: session.instagramUserId,
    };

    return true;
  }
}
