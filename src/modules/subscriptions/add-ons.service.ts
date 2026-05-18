// ── AddOnsService ─────────────────────────────────────────────
// Handles add-on purchase and cancellation lifecycle.
//
// Purchase flow:
//   1. Guard: reject if user has payment_owed (Req 25.3)
//   2. Charge via PaymentPort
//   3. Insert add_on_purchases row with lifecycle-specific fields
//   4. Append addon_purchased audit event
//
// Cancel flow:
//   1. Look up the purchase by id + userId
//   2. Set status to 'canceling' (recurring) or 'canceled' (one_time)
//   3. Append addon_canceled audit event
//
// Requirements: 12.1, 12.3, 12.4, 12.5, 13.1, 14.1, 14.5, 14.7, 14.8

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { addOnPurchases } from '../../database/schema/add_on_purchases.schema';
import type { AddOnPurchase } from '../../database/schema/add_on_purchases.schema';
import { subscriptions } from '../../database/schema/subscriptions.schema';
import { payments } from '../../database/schema/payments.schema';
import { PaymentPort } from './ports/payment.port';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionEventsRepository } from './subscription-events.repository';
import { PaymentOwedError, PaymentFailedError } from './subscriptions.errors';

// ── Add-on catalog constants ──────────────────────────────────────────────

/** Lifecycle classification per Req 12.3, 12.4, 12.5 */
const ADDON_LIFECYCLE = {
  boost: 'one_time',
  ai_growth_pack: 'recurring',
  content_studio_pack: 'recurring',
} as const;

/** Duration in days for the boost one-time window (Req 12.3, 13.1) */
const BOOST_DURATION_DAYS = 7;

/** Period length in days for recurring add-ons (Req 14.1) */
const RECURRING_PERIOD_DAYS = 30;

/**
 * Add-on price catalog in minor currency units.
 *
 * Mirrors the canonical values from design.md §Add-ons. Kept inline because
 * add-ons aren't (yet) stored in the `plans` table — they have their own
 * lifecycle and pricing model. When more locales / currencies are added,
 * promote this to a Drizzle table seeded the same way as `plans`.
 */
const ADDON_PRICES: Record<
  'boost' | 'ai_growth_pack' | 'content_studio_pack',
  Record<'IN' | 'US', { amountMinor: number; currency: 'INR' | 'USD' }>
> = {
  boost: {
    IN: { amountMinor: 19900, currency: 'INR' }, // ₹199 / 7-day window
    US: { amountMinor: 299, currency: 'USD' }, //  $2.99
  },
  ai_growth_pack: {
    IN: { amountMinor: 29900, currency: 'INR' }, // ₹299/mo
    US: { amountMinor: 399, currency: 'USD' }, //  $3.99/mo
  },
  content_studio_pack: {
    IN: { amountMinor: 49900, currency: 'INR' }, // ₹499/mo
    US: { amountMinor: 599, currency: 'USD' }, //  $5.99/mo
  },
};

/** Display labels for receipts / order descriptions. */
const ADDON_LABELS: Record<
  'boost' | 'ai_growth_pack' | 'content_studio_pack',
  string
> = {
  boost: 'Boost',
  ai_growth_pack: 'AI Growth Pack',
  content_studio_pack: 'Content Studio Pack',
};

// ── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class AddOnsService {
  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly paymentPort: PaymentPort,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionEventsRepository: SubscriptionEventsRepository,
  ) {}

  /**
   * Purchase an add-on for the given user.
   *
   * Steps:
   *   1. Verify the user's subscription does not have payment_owed (Req 25.3)
   *   2. Charge via PaymentPort
   *   3. Insert add_on_purchases row with lifecycle-appropriate fields:
   *      - boost (one_time): effectiveStart = now, effectiveEnd = now + 7d (Req 13.1)
   *      - ai_growth_pack (recurring): currentPeriodStart = now, currentPeriodEnd = now + 30d,
   *        consumptionCounters = {} (Req 14.1)
   *      - content_studio_pack (recurring): currentPeriodStart = now, currentPeriodEnd = now + 30d,
   *        consumptionCounters = { videoEditsUsed: 0, scriptsUsed: 0 } (Req 14.1, 12.5)
   *   4. Append addon_purchased audit event (Req 24.2)
   *
   * Requirements: 12.1, 12.3, 12.4, 12.5, 13.1, 14.1
   */
  async purchase(
    userId: string,
    addonId: 'boost' | 'ai_growth_pack' | 'content_studio_pack',
  ): Promise<AddOnPurchase> {
    return this.db.transaction(async (tx: any) => {
      // 1. Check payment_owed — block purchases if flag is set (Req 25.3)
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

      if (sub?.paymentOwed) {
        throw new PaymentOwedError(userId);
      }

      // Resolve locale from subscription (default to 'IN' if no subscription yet)
      const locale: 'IN' | 'US' = sub?.locale ?? 'IN';

      // 2. Charge via PaymentPort
      const now = new Date();
      const idempotencyKey = `addon_purchase:${userId}:${addonId}:${now.toISOString()}`;

      const chargeResult = await this.paymentPort.charge({
        userId,
        amountMinor: 0, // Amount resolved by PaymentPort adapter from catalog; 0 is a placeholder
        currency: locale === 'IN' ? 'INR' : 'USD',
        idempotencyKey,
        description: `Add-on purchase: ${addonId}`,
      });

      if (!chargeResult.success) {
        throw new PaymentFailedError(chargeResult.error);
      }

      // 3. Build the add_on_purchases row based on lifecycle
      const lifecycle = ADDON_LIFECYCLE[addonId];
      let insertValues: any;

      if (lifecycle === 'one_time') {
        // boost: duration-based, no credits (Req 13.1)
        const effectiveEnd = new Date(now.getTime() + BOOST_DURATION_DAYS * 24 * 60 * 60 * 1000);
        insertValues = {
          userId,
          addonId,
          lifecycle: 'one_time' as const,
          status: 'active' as const,
          effectiveStart: now,
          effectiveEnd,
          remainingCredits: null,
          consumptionCounters: null,
          locale,
        };
      } else {
        // recurring: ai_growth_pack or content_studio_pack (Req 14.1)
        const currentPeriodEnd = new Date(now.getTime() + RECURRING_PERIOD_DAYS * 24 * 60 * 60 * 1000);

        // content_studio_pack tracks video edits and scripts (Req 12.5)
        const consumptionCounters =
          addonId === 'content_studio_pack'
            ? { videoEditsUsed: 0, scriptsUsed: 0 }
            : {};

        insertValues = {
          userId,
          addonId,
          lifecycle: 'recurring' as const,
          status: 'active' as const,
          currentPeriodStart: now,
          currentPeriodEnd,
          remainingCredits: null,
          consumptionCounters,
          locale,
        };
      }

      const [created] = await tx
        .insert(addOnPurchases)
        .values(insertValues)
        .returning();

      // 4. Append audit event (Req 24.2)
      await this.subscriptionEventsRepository.append(tx, {
        userId,
        subscriptionId: sub?.id,
        eventType: 'addon_purchased',
        actorType: 'user',
        afterSnapshot: created as Record<string, unknown>,
      });

      return created as AddOnPurchase;
    });
  }

  /**
   * Prepares an add-on purchase by computing the charge amount and
   * returning the data the client needs to open Razorpay Checkout. Does
   * not mutate state; the actual purchase row is written by
   * {@link finalizePurchase} after the client returns the verified
   * payment id.
   *
   * Requirements: 12.1, 12.3, 12.4, 12.5
   */
  async preparePurchase(
    userId: string,
    addonId: 'boost' | 'ai_growth_pack' | 'content_studio_pack',
  ): Promise<{
    amountMinor: number;
    currency: 'INR' | 'USD';
    idempotencyKey: string;
    description: string;
  }> {
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });
    if (sub?.paymentOwed) {
      throw new PaymentOwedError(userId);
    }

    const locale: 'IN' | 'US' = sub?.locale ?? 'IN';
    const price = ADDON_PRICES[addonId][locale];
    // Stable per (user, addon, day) — re-tries on the same day reuse the
    // same Razorpay order via `receipt`. We deliberately bucket by day so
    // that a user who closes Checkout and re-opens it within the same day
    // does not generate orphan orders, but a different day's purchase is
    // a fresh intent.
    const dayKey = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `addon_purchase:${userId}:${addonId}:${dayKey}`;

    return {
      amountMinor: price.amountMinor,
      currency: price.currency,
      idempotencyKey,
      description: `Add-on purchase: ${ADDON_LABELS[addonId]}`,
    };
  }

  /**
   * Finalizes an add-on purchase after the client has paid via Razorpay.
   * The caller (controller) is expected to have verified the payment
   * signature already; this method only persists the purchase row + a
   * matching `payments` ledger entry under one transaction.
   *
   * Requirements: 12.1, 12.3, 12.4, 12.5, 13.1, 14.1
   */
  async finalizePurchase(
    userId: string,
    addonId: 'boost' | 'ai_growth_pack' | 'content_studio_pack',
    providerRef: string,
  ): Promise<AddOnPurchase> {
    return this.db.transaction(async (tx: any) => {
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });
      if (sub?.paymentOwed) {
        throw new PaymentOwedError(userId);
      }

      const locale: 'IN' | 'US' = sub?.locale ?? 'IN';
      const price = ADDON_PRICES[addonId][locale];
      const now = new Date();
      const dayKey = now.toISOString().slice(0, 10);
      const idempotencyKey = `addon_purchase:${userId}:${addonId}:${dayKey}`;

      // Record payment first so reversal lookup by providerRef works even
      // if the purchase row insert later fails.
      await tx
        .insert(payments)
        .values({
          userId,
          amountMinorUnits: price.amountMinor,
          currency: price.currency,
          providerRef,
          status: 'succeeded' as const,
          idempotencyKey,
          chargedAt: now,
        })
        .onConflictDoNothing();

      const lifecycle = ADDON_LIFECYCLE[addonId];
      let insertValues: any;

      if (lifecycle === 'one_time') {
        const effectiveEnd = new Date(
          now.getTime() + BOOST_DURATION_DAYS * 24 * 60 * 60 * 1000,
        );
        insertValues = {
          userId,
          addonId,
          lifecycle: 'one_time' as const,
          status: 'active' as const,
          effectiveStart: now,
          effectiveEnd,
          remainingCredits: null,
          consumptionCounters: null,
          locale,
        };
      } else {
        const currentPeriodEnd = new Date(
          now.getTime() + RECURRING_PERIOD_DAYS * 24 * 60 * 60 * 1000,
        );
        const consumptionCounters =
          addonId === 'content_studio_pack'
            ? { videoEditsUsed: 0, scriptsUsed: 0 }
            : {};

        insertValues = {
          userId,
          addonId,
          lifecycle: 'recurring' as const,
          status: 'active' as const,
          currentPeriodStart: now,
          currentPeriodEnd,
          remainingCredits: null,
          consumptionCounters,
          locale,
        };
      }

      const [created] = await tx
        .insert(addOnPurchases)
        .values(insertValues)
        .returning();

      await this.subscriptionEventsRepository.append(tx, {
        userId,
        subscriptionId: sub?.id,
        eventType: 'addon_purchased',
        actorType: 'user',
        afterSnapshot: created as Record<string, unknown>,
      });

      return created as AddOnPurchase;
    });
  }

  /**
   * Cancel an add-on purchase.
   *
   * For recurring add-ons: sets status to 'canceling' — access continues until
   * current_period_end, at which point the scheduler sets it to 'canceled' (Req 14.5).
   *
   * For one_time (boost): sets status to 'canceled' immediately, since there is
   * no renewal to wait for (Req 14.5 by analogy; boost has no period end to honor).
   *
   * Appends addon_canceled audit event (Req 24.2).
   *
   * Requirements: 14.5, 14.7, 14.8
   */
  async cancel(userId: string, purchaseId: string): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      // 1. Find the purchase and verify ownership
      const purchase = await tx.query.addOnPurchases.findFirst({
        where: and(
          eq(addOnPurchases.id, purchaseId),
          eq(addOnPurchases.userId, userId),
        ),
      });

      if (!purchase) {
        throw new NotFoundException(
          `Add-on purchase "${purchaseId}" not found for user "${userId}"`,
        );
      }

      // 2. Determine new status:
      //    - recurring → 'canceling' (retain access until period end, Req 14.5)
      //    - one_time  → 'canceled' immediately (no renewal period to honor)
      const newStatus =
        purchase.lifecycle === 'recurring' ? 'canceling' : 'canceled';

      const [updated] = await tx
        .update(addOnPurchases)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(
          and(
            eq(addOnPurchases.id, purchaseId),
            eq(addOnPurchases.userId, userId),
          ),
        )
        .returning();

      // 3. Append audit event (Req 24.2)
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

      await this.subscriptionEventsRepository.append(tx, {
        userId,
        subscriptionId: sub?.id,
        eventType: 'addon_canceled',
        actorType: 'user',
        beforeSnapshot: purchase as Record<string, unknown>,
        afterSnapshot: updated as Record<string, unknown>,
      });
    });
  }
}
