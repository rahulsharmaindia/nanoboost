// ── Follows controller ───────────────────────────────────────
// Endpoints for creators to manage which brands they follow.

import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { FollowsService } from './follows.service';

interface FollowBody {
  brandName: string;
  businessId?: string | null;
}

@Controller('api/follows/brands')
@UseGuards(AuthGuard)
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.followsService.list((req as any).sessionId);
  }

  @Post()
  follow(@Req() req: Request, @Body() body: FollowBody) {
    return this.followsService.follow(
      (req as any).sessionId,
      body?.brandName ?? '',
      body?.businessId ?? null,
    );
  }

  @Delete(':brandName')
  unfollow(@Req() req: Request, @Param('brandName') brandName: string) {
    return this.followsService.unfollow((req as any).sessionId, decodeURIComponent(brandName));
  }
}
