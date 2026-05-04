// ── Brand auth guard ─────────────────────────────────────────
// Validates that the session belongs to a brand (has businessId).
// Used on brand-only endpoints.

import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { SessionService } from '../services/session.service';
import { UnauthorizedError } from '../errors/app.errors';

@Injectable()
export class BrandAuthGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const sessionId =
      request.headers['authorization']?.replace('Bearer ', '') ||
      request.query.session_id;

    if (!sessionId) {
      throw new UnauthorizedError('Not authenticated');
    }

    const session = this.sessionService.get(sessionId);

    if (!session || !session.businessId) {
      throw new UnauthorizedError('Not authenticated');
    }

    request.sessionId = sessionId;
    request.user = { sessionId, businessId: session.businessId };

    return true;
  }
}
