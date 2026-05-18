// ── ServerTokenGuard ─────────────────────────────────────────
// Guards server-to-server (internal) endpoints by validating a
// shared secret passed in the `x-server-token` request header.
//
// The expected token is read from the INTERNAL_SERVER_TOKEN env var.
// If the env var is not set the guard always rejects, preventing
// accidental exposure in environments where the secret was not
// configured.
//
// Requirements: 3.5, 3.7

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class ServerTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-server-token'];
    const expectedToken = process.env.INTERNAL_SERVER_TOKEN;

    if (!expectedToken || token !== expectedToken) {
      throw new UnauthorizedException('Invalid server token');
    }
    return true;
  }
}
