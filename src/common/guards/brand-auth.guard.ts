// ── Brand auth guard ─────────────────────────────────────────
// Validates that the session belongs to a brand. Attaches
// req.brandId and req.businessId for downstream use.

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { BrandSessionService } from '../services/brand-session.service';
import { UnauthorizedError } from '../errors/app.errors';

@Injectable()
export class BrandAuthGuard implements CanActivate {
  constructor(private readonly brandSessionService: BrandSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const sessionId =
      request.headers['authorization']?.replace('Bearer ', '') ||
      request.query.session_id;

    if (!sessionId) {
      throw new UnauthorizedError('Not authenticated');
    }

    const session = await this.brandSessionService.getSession(sessionId);
    if (!session) {
      throw new UnauthorizedError('Not authenticated');
    }

    request.sessionId = sessionId;
    request.brandId = session.brandId;
    request.businessId = session.businessId;
    request.user = {
      sessionId,
      brandId: session.brandId,
      businessId: session.businessId,
    };

    return true;
  }
}
