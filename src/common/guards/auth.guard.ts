// ── Auth guard ───────────────────────────────────────────────
// Validates the session token from Authorization header or query
// param. Attaches req.accessToken and req.sessionId for downstream
// use. Routes decorated with @Public() bypass this guard.

import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionService } from '../services/session.service';
import { UnauthorizedError } from '../errors/app.errors';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
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

    // Attach to request for downstream use
    request.accessToken = session.accessToken;
    request.sessionId = sessionId;
    request.user = { sessionId, userId: session.providerUserId };

    return true;
  }
}
