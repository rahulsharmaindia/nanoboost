// ── Auth guard ───────────────────────────────────────────────
// Validates the session token from Authorization header or query param.
// Attaches req.user and req.accessToken for downstream use.
// Routes decorated with @Public() bypass this guard.

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Optional,
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

  canActivate(context: ExecutionContext): boolean {
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

    const session = this.sessionService.get(sessionId);

    if (!session || !session.accessToken) {
      throw new UnauthorizedError('Not authenticated');
    }

    // Attach to request for downstream use
    request.accessToken = session.accessToken;
    request.sessionId = sessionId;
    request.user = { sessionId, userId: session.userId };

    return true;
  }
}
