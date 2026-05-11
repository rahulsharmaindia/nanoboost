// ── Auth guard ───────────────────────────────────────────────
// Validates the session token from Authorization header or query
// param. Attaches req.accessToken and req.sessionId for downstream
// use. Routes decorated with @Public() bypass this guard.
//
// Token freshness: when the session's Instagram long-lived token
// is within the refresh window, MetaTokenService refreshes it in
// place before the request proceeds. This keeps active users
// logged in across the full 60-day token window (and beyond)
// without ever forcing them back through Instagram OAuth.

import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionService } from '../services/session.service';
import { MetaTokenService } from '../../modules/meta/meta-token.service';
import { UnauthorizedError } from '../errors/app.errors';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
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

    const session = await this.sessionService.get(sessionId);

    if (!session || !session.accessToken) {
      throw new UnauthorizedError('Not authenticated');
    }

    // Lazily refresh the IG long-lived token if it's close to expiry.
    // No-op for brand sessions (no providerUserId / tokenExpiresAt).
    // Throws UnauthorizedError if the token is dead and cannot be
    // refreshed, which the global filter turns into a 401.
    const accessToken = session.providerUserId
      ? await this.metaTokenService.ensureFreshToken(session)
      : session.accessToken;

    // Attach to request for downstream use
    request.accessToken = accessToken;
    request.sessionId = sessionId;
    request.user = { sessionId, userId: session.providerUserId };

    return true;
  }
}
