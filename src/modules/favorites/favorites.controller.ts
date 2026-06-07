// ── Favorites controller ─────────────────────────────────────
// Influencer endpoints to save / unsave / list favorite campaigns.

import { Controller, Get, Post, Delete, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { FavoritesService } from './favorites.service';

@Controller('api/saved-campaigns')
@UseGuards(AuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  list(@Req() req: Request) {
    return this.favoritesService.list((req as any).influencerId);
  }

  @Post(':campaignId')
  async save(@Req() req: Request, @Param('campaignId') campaignId: string) {
    await this.favoritesService.save((req as any).influencerId, campaignId);
    return { status: 'saved' };
  }

  @Delete(':campaignId')
  async unsave(@Req() req: Request, @Param('campaignId') campaignId: string) {
    await this.favoritesService.unsave((req as any).influencerId, campaignId);
    return { status: 'removed' };
  }
}
