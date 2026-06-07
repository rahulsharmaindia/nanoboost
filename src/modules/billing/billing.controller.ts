// ── Billing controller ───────────────────────────────────────
// Plans catalog + influencer subscription management (feature #9).

import { Controller, Get, Post, Body, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { BillingService } from './billing.service';

@Controller('api/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  // GET /api/billing/plans?locale=IN  (public catalog)
  @Public()
  @Get('plans')
  listPlans(@Query('locale') locale?: string) {
    return this.billingService.listPlans(locale);
  }

  // GET /api/billing/subscription
  @UseGuards(AuthGuard)
  @Get('subscription')
  getSubscription(@Req() req: Request) {
    return this.billingService.getMySubscription((req as any).influencerId);
  }

  // POST /api/billing/subscribe { tier, locale }
  @UseGuards(AuthGuard)
  @Post('subscribe')
  subscribe(@Req() req: Request, @Body() body: { tier: string; locale: string }) {
    return this.billingService.subscribe(
      (req as any).influencerId,
      body?.tier,
      body?.locale,
    );
  }

  // POST /api/billing/cancel
  @UseGuards(AuthGuard)
  @Post('cancel')
  cancel(@Req() req: Request) {
    return this.billingService.cancel((req as any).influencerId);
  }
}
