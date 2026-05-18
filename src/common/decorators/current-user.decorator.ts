// ── CurrentUser decorator ────────────────────────────────────
// Extracts the authenticated user from the request object.
// The auth guard attaches req.user before this is called.

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
