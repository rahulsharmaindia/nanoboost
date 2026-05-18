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
  BadRequestException,
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
import { PaymentPort } from './ports/payment.port';
import { RazorpayPaymentAdapter } from './adapters/razorpay-payment.adapter';

@Controller('v1/add-ons')
@UseGuards(AuthGuard)
export class AddOnsController {
  constructor(
    private readonly addOnsService: AddOnsService,
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly paymentPort: PaymentPort,
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

  // ── Razorpay interactive purchase flow (web) ─────────────────────────

  /**
   * POST /v1/add-ons/me/purchase/order
   *
   * Step 1 of the Razorpay add-on purchase flow. Computes the price for
   * the requested add-on and returns a Razorpay order id + public key id
   * so the client can open Razorpay Checkout.
   *
   * Does NOT create the add_on_purchases row. The actual purchase is
   * persisted by `/purchase/verify` after the user has paid.
   */
  @Post('me/purchase/order')
  async createPurchaseOrder(
    @Req() req: Request,
    @Body() dto: PurchaseAddonDto,
  ): Promise<any> {
    const userId = (req as any).providerUserId as string;
    const intent = await this.addOnsService.preparePurchase(
      userId,
      dto.addonId,
    );
    const adapter = this.requireRazorpay();
    const order = await adapter.createOrder({
      userId,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      idempotencyKey: intent.idempotencyKey,
      description: intent.description,
    });
    return { ...order, addonId: dto.addonId };
  }

  /**
   * POST /v1/add-ons/me/purchase/verify
   *
   * Step 2 of the Razorpay add-on purchase flow. Verifies the payload
   * returned by Razorpay Checkout's `handler` callback, then creates the
   * add_on_purchases row + matching `payments` ledger entry under one
   * transaction.
   *
   * Body:
   * ```json
   * {
   *   "addonId": "boost" | "ai_growth_pack" | "content_studio_pack",
   *   "razorpayOrderId":  "order_NXa83hG...",
   *   "razorpayPaymentId": "pay_NXa83hH...",
   *   "razorpaySignature": "<hex>"
   * }
   * ```
   */
  @Post('me/purchase/verify')
  async verifyPurchase(
    @Req() req: Request,
    @Body() body: any,
  ): Promise<any> {
    const userId = (req as any).providerUserId as string;
    const addonId = body?.addonId;
    const razorpayOrderId = body?.razorpayOrderId;
    const razorpayPaymentId = body?.razorpayPaymentId;
    const razorpaySignature = body?.razorpaySignature;

    if (
      !['boost', 'ai_growth_pack', 'content_studio_pack'].includes(addonId) ||
      typeof razorpayOrderId !== 'string' ||
      typeof razorpayPaymentId !== 'string' ||
      typeof razorpaySignature !== 'string'
    ) {
      throw new BadRequestException(
        'Required: addonId (boost|ai_growth_pack|content_studio_pack), razorpayOrderId, razorpayPaymentId, razorpaySignature.',
      );
    }

    const adapter = this.requireRazorpay();
    const { providerRef } = adapter.verifyPayment({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    const purchase = await this.addOnsService.finalizePurchase(
      userId,
      addonId,
      providerRef,
    );
    return { purchase };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Narrows the injected PaymentPort to a RazorpayPaymentAdapter, throwing
   * a clear 400 when the active adapter is not Razorpay.
   */
  private requireRazorpay(): RazorpayPaymentAdapter {
    if (!(this.paymentPort instanceof RazorpayPaymentAdapter)) {
      throw new BadRequestException(
        'razorpay_unavailable — set PAYMENT_ADAPTER=razorpay and provide ' +
          'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to use the add-on purchase flow.',
      );
    }
    return this.paymentPort;
  }
}
