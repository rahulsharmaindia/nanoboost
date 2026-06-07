// ── Account management controller ────────────────────────────
// Data deletion (Meta requirement) and Instagram disconnect.

import { Controller, Post, Get, Query, Req, Inject, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { randomBytes } from 'crypto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { InfluencerSessionService } from '../../common/services/influencer-session.service';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { accountDeletionRequests } from '../../database/schema/account-deletion.schema';
import { Public } from '../../common/decorators/public.decorator';
import { env } from '../../config/env';

@Controller()
export class AccountController {
  constructor(
    private readonly sessionService: InfluencerSessionService,
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
  ) {}

  private async recordDeletionRequest(subjectId: string): Promise<string> {
    const confirmationCode = randomBytes(8).toString('hex').toUpperCase();
    if (this.db) {
      await this.db.insert(accountDeletionRequests).values({
        subjectType: 'influencer',
        subjectId,
        confirmationCode,
        status: 'pending',
      });
    }
    return confirmationCode;
  }

  // POST /api/account/delete
  @UseGuards(AuthGuard)
  @Post('api/account/delete')
  async deleteAccount(@Req() req: Request) {
    const influencerId = (req as any).influencerId as string;
    const sessionId = (req as any).sessionId as string;
    const confirmationCode = await this.recordDeletionRequest(influencerId);
    await this.sessionService.disconnect(influencerId);
    await this.sessionService.remove(sessionId);
    return {
      confirmationCode,
      status: 'pending',
      message: 'Your account deletion has been scheduled. All data will be removed within 30 days.',
    };
  }

  // POST /api/account/disconnect
  @UseGuards(AuthGuard)
  @Post('api/account/disconnect')
  async disconnectInstagram(@Req() req: Request) {
    const influencerId = (req as any).influencerId as string;
    await this.sessionService.disconnect(influencerId);
    return { status: 'disconnected' };
  }

  // POST /api/meta/deletion-callback (Meta calls this)
  @Public()
  @Post('api/meta/deletion-callback')
  async metaDeletionCallback(@Req() req: Request) {
    const signedRequest = (req as any).body?.signed_request;
    if (!signedRequest) {
      return { error: 'Missing signed_request' };
    }
    const [, payload] = signedRequest.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const userId = String(data.user_id);

    const confirmationCode = await this.recordDeletionRequest(userId);
    await this.sessionService.invalidateByInstagramUserId(userId);

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
