// ── Follows controller ───────────────────────────────────────
// Endpoints for influencers to manage which brands they follow.
// Brands are referenced by their business_id slug.

import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { FollowsService } from './follows.service';

interface FollowBody {
  businessId: string;
}

@Controller('api/follows/brands')
@UseGuards(AuthGuard)
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.followsService.list((req as any).influencerId);
  }

  @Post()
  follow(@Req() req: Request, @Body() body: FollowBody) {
    return this.followsService.follow((req as any).influencerId, body?.businessId ?? '');
  }

  @Delete(':businessId')
  unfollow(@Req() req: Request, @Param('businessId') businessId: string) {
    return this.followsService.unfollow(
      (req as any).influencerId,
      decodeURIComponent(businessId),
    );
  }
}
