// ── Add-ons controller ────────────────────────────────────────
// HTTP route handlers for /v1/add-ons endpoints.
//
// Routes:
//   GET  /v1/add-ons/me            — list the authenticated user's add-on purchases
//   POST /v1/add-ons/me/purchase   — purchase an add-on
//   POST /v1/add-ons/me/:id/cancel — cancel an active add-on purchase
//
// Requirements: 12.1, 13.1, 14.5

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { eq } from 'drizzle-orm';
import { AuthGuard } from '../../common/guards/auth.guard';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { addOnPurchases } from '../../database/schema/add_on_purchases.schema';
import { AddOnsService } from './add-ons.service';
import { PurchaseAddonDto } from './dto/purchase-addon.dto';

@Controller('v1/add-ons')
@UseGuards(AuthGuard)
export class AddOnsController {
  constructor(
    private readonly addOnsService: AddOnsService,
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
  ) {}

  /**
   * GET /v1/add-ons/me
   *
   * Returns all add-on purchases for the authenticated creator.
   * Requirement 12.1: creators can view their active add-ons.
   */
  @Get('me')
  async getMyAddOns(@Req() req: Request): Promise<{ addOns: any[] }> {
    const userId = (req as any).providerUserId as string;

    const purchases = await this.db.query.addOnPurchases.findMany({
      where: eq(addOnPurchases.userId, userId),
    });

    return { addOns: purchases };
  }

  /**
   * POST /v1/add-ons/me/purchase
   *
   * Purchases an add-on for the authenticated creator.
   * Body: { addonId: 'boost' | 'ai_growth_pack' | 'content_studio_pack' }
   * Requirement 12.1: creator can purchase add-ons.
   * Requirement 13.1: boost add-on activates a 7-day window.
   */
  @Post('me/purchase')
  async purchase(
    @Req() req: Request,
    @Body() dto: PurchaseAddonDto,
  ): Promise<{ purchase: any }> {
    const userId = (req as any).providerUserId as string;
    const purchase = await this.addOnsService.purchase(userId, dto.addonId);
    return { purchase };
  }

  /**
   * POST /v1/add-ons/me/:id/cancel
   *
   * Cancels an active add-on purchase for the authenticated creator.
   * Recurring add-ons move to 'canceling' (access until period end).
   * One-time add-ons are canceled immediately.
   * Requirement 14.5: cancellation sets status to 'canceling' for recurring add-ons.
   */
  @Post('me/:id/cancel')
  async cancel(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const userId = (req as any).providerUserId as string;
    await this.addOnsService.cancel(userId, id);
    return { success: true };
  }
}
