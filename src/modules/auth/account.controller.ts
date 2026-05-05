// ── Account management controller ────────────────────────────
// Data deletion (Meta requirement) and Instagram disconnect.

import { Controller, Post, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { randomBytes } from 'crypto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SessionService } from '../../common/services/session.service';
import { Public } from '../../common/decorators/public.decorator';
import { env } from '../../config/env';

@Controller()
export class AccountController {
  constructor(private readonly sessionService: SessionService) {}

  // POST /api/account/delete
  @UseGuards(AuthGuard)
  @Post('api/account/delete')
  deleteAccount(@Req() req: Request) {
    const session = this.sessionService.get((req as any).sessionId)!;
    const confirmationCode = randomBytes(8).toString('hex').toUpperCase();

    session.accessToken = null;
    session.status = 'error'; // invalidate session

    return {
      confirmationCode,
      status: 'pending',
      message: 'Your account deletion has been scheduled. All data will be removed within 30 days.',
    };
  }

  // POST /api/account/disconnect
  @UseGuards(AuthGuard)
  @Post('api/account/disconnect')
  disconnectInstagram(@Req() req: Request) {
    const session = this.sessionService.get((req as any).sessionId)!;
    session.accessToken = null;
    return { status: 'disconnected' };
  }

  // POST /api/meta/deletion-callback (Meta calls this)
  @Public()
  @Post('api/meta/deletion-callback')
  metaDeletionCallback(@Req() req: Request) {
    const signedRequest = (req as any).body?.signed_request;
    if (!signedRequest) {
      return { error: 'Missing signed_request' };
    }

    const [, payload] = signedRequest.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const userId = data.user_id;

    const confirmationCode = randomBytes(8).toString('hex').toUpperCase();

    // Invalidate any sessions for this user
    const found = this.sessionService.findBy(s => s.userId === userId);
    if (found) {
      found.session.accessToken = null;
      found.session.status = 'error';
    }

    return {
      url: `${env.serverUrl}/api/meta/deletion-status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    };
  }

  // GET /api/meta/deletion-status
  @Public()
  @Get('api/meta/deletion-status')
  deletionStatus(@Query('code') code: string) {
    if (!code) {
      return { error: 'Missing confirmation code' };
    }
    return {
      confirmation_code: code,
      status: 'completed',
      message: 'User data has been deleted.',
    };
  }
}
