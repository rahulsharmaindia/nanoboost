// ── Creators controller ──────────────────────────────────────
// Brand-authenticated endpoint to search creator profiles.

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CreatorsService } from './creators.service';
import { BrandAuthGuard } from '../../common/guards/brand-auth.guard';

@Controller('api/creators')
export class CreatorsController {
  constructor(private readonly creatorsService: CreatorsService) {}

  // GET /api/creators/search?query=...&niche=...&page=1&limit=20
  @UseGuards(BrandAuthGuard)
  @Get('search')
  search(
    @Query('query') query?: string,
    @Query('niche') niche?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.creatorsService.search({
      query,
      niche,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }
}
