// ── Subscriptions service ────────────────────────────────────
// Orchestration layer for subscription lifecycle, tier transitions,
// cap enforcement, add-on management, and renewal scheduling.
// All monetary arithmetic is delegated to MoneyMathService.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { subscriptions } from '../../database/schema/subscriptions.schema';
import type { Subscription } from '../../database/schema/subscriptions.schema';
import { usageCounters } from '../../database/schema/usage_counters.schema';
import { addOnPurchases } from '../../database/schema/add_on_purchases.schema';
import { payments } from '../../database/schema/payments.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionEventsRepository } from './subscription-events.repository';
import {
  SubscriptionProvisioningError,
  SubscriptionNotFoundError,
  InvalidDowngradeTargetError,
  PaymentFailedError,
  PaymentOwedError,
} from './subscriptions.errors';
import { MoneyMathService } from './money-math.service';
import { PaymentPort } from './ports/payment.port';
import { PlansCatalogService } from './plans-catalog.service';
import { tierRank } from './subscriptions.types';
import type { Tier } from './subscriptions.types';

/** Add `days` calendar days to a Date, returning a new Date. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionEventsRepository: SubscriptionEventsRepository,
    private readonly moneyMathService: MoneyMathService,
    private readonly paymentPort: PaymentPort,
    private readonly plansCatalogService: PlansCatalogService,
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {}

  private readonly logger = new Logger(SubscriptionsService.name);

  /**
   * Provisions a creator-tier subscription for a newly registered user.
   *
   * Creates an active subscription with a 30-day initial period starting now.
   * Idempotent: if a subscription already exists for the user (returning user
   * logging in again), the existing row is returned unchanged. This makes it
   * safe to call on every successful OAuth authentication.
   *
   * If the insert fails for any reason other than a duplicate userId (e.g. DB
   * connectivity, constraint violation on other fields), a
   * `SubscriptionProvisioningError` is thrown so the caller (signup flow) can
   * surface a meaningful error rather than a raw DB error.
   *
   * Requirements: 17.5, 17.6, 4.5
   */
  async createForNewUser(userId: string, locale: 'IN' | 'US' = 'IN'): Promise<Subscription> {
    try {
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Attempt to insert; if a subscription already exists for this userId
      // (returning user), the ON CONFLICT DO NOTHING clause skips the insert
      // and we fall through to fetch the existing row.
      const inserted = await this.db.insert(subscriptions).values({
        userId,
        tier: 'creator',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        locale,
      })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) {
        return inserted[0];
      }

      // Subscription already exists (returning user) — fetch and return it.
      const existing = await this.db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

      if (!existing) {
        // Should never happen: insert was a no-op but row is missing.
        throw new SubscriptionProvisioningError(
          `Subscription insert was a no-op but no existing row found for user ${userId}`,
        );
      }

      return existing;
    } catch (error) {
      if (error instanceof SubscriptionProvisioningError) {
        throw error;
      }
      throw new SubscriptionProvisioningError(
        `Failed to provision subscription for user ${userId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Upgrades a user's subscription to a higher tier.
   *
   * Two upgrade paths:
   *   - Free (creator) → paid: charges the full new-plan price, starts a fresh
   *     30-day period from now, and resets all usage counters.
   *   - Paid → paid (higher rank): charges a prorated delta for the remaining
   *     days in the current period (via MoneyMathService.proratedUpgrade),
   *     preserves the existing period anniversary, and does NOT reset counters.
   *
   * The entire operation — charge, subscription update, counter reset, and audit
   * event — runs inside a single database transaction. If the payment fails the
   * transaction is rolled back and a PaymentFailedError is thrown.
   *
   * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 22.5
   */
  async upgrade(userId: string, targetTier: 'growth' | 'studio'): Promise<Subscription> {
    return this.db.transaction(async (tx: any) => {
      // 1. Fetch the current subscription row
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });
      if (!sub) throw new SubscriptionNotFoundError(userId);

      // 2. Block upgrades while a payment is owed (Req 25.3: "suspend the
      //    ability to initiate further upgrades or add-on purchases until
      //    resolved")
      if (sub.paymentOwed) {
        throw new PaymentOwedError(userId);
      }

      // 3. Validate upgrade direction — target must be strictly higher rank
      if (tierRank(targetTier) <= tierRank(sub.tier as Tier)) {
        throw new InvalidDowngradeTargetError(
          'Target tier must be higher rank than current tier',
        );
      }

      // 3. Resolve plans for old and new tier
      const { plan: oldPlan } = await this.plansCatalogService.getPlan(
        sub.tier as Tier,
        sub.locale,
      );
      const { plan: newPlan } = await this.plansCatalogService.getPlan(
        targetTier,
        sub.locale,
      );

      // 4. Calculate charge amount and new period boundaries
      let chargeAmount: number;
      let nextStart: Date = sub.currentPeriodStart;
      let nextEnd: Date = sub.currentPeriodEnd;
      let resetCounters = false;

      if (sub.tier === 'creator') {
        // Free → paid: full price, fresh 30-day period, reset counters
        chargeAmount = newPlan.priceMinorUnits;
        nextStart = new Date();
        nextEnd = addDays(nextStart, 30);
        resetCounters = true;
      } else {
        // Paid → paid: prorated delta, preserve anniversary, no counter reset
        const elapsedDays = Math.floor(
          (Date.now() - sub.currentPeriodStart.getTime()) / (24 * 60 * 60 * 1000),
        );
        chargeAmount = this.moneyMathService.proratedUpgrade(
          oldPlan.priceMinorUnits,
          newPlan.priceMinorUnits,
          elapsedDays,
          30,
        );
      }

      // 5. Charge via PaymentPort
      const charge = await this.paymentPort.charge({
        userId,
        amountMinor: chargeAmount,
        currency: newPlan.currency,
        idempotencyKey: `upgrade:${sub.id}:${targetTier}:${sub.currentPeriodStart.toISOString()}`,
      });
      if (!charge.success) throw new PaymentFailedError(charge.error);

      // 6. Update subscription row
      const [updated] = await tx
        .update(subscriptions)
        .set({
          tier: targetTier,
          currentPeriodStart: nextStart,
          currentPeriodEnd: nextEnd,
          pendingTier: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id))
        .returning();

      // 7. Reset usage counters for free → paid upgrades
      if (resetCounters) {
        await tx.delete(usageCounters).where(eq(usageCounters.userId, userId));
      }

      // 8. Append audit event in the same transaction
      await this.subscriptionEventsRepository.append(tx, {
        userId,
        subscriptionId: sub.id,
        eventType: 'tier_upgraded',
        actorType: 'user',
        beforeSnapshot: sub as Record<string, unknown>,
        afterSnapshot: updated as Record<string, unknown>,
      });

      return updated;
    });
  }

  /**
   * Handles a payment reversal (chargeback, refund, network reversal) for a
   * subscription charge.
   *
   * Looks up the original charge by chargeId (providerRef) to determine how
   * many days have elapsed between the charge and the reversal:
   *
   *   < 7 days  → roll back tier to creator, reset usage counters and
   *               concurrent state, append audit event, notify user.
   *   ≥ 7 days  → retain active tier, set payment_owed = true (suspends
   *               further upgrades/purchases), append audit event, notify user.
   *
   * The entire operation runs inside a single database transaction.
   *
   * Requirements: 25.1, 25.2, 25.3, 25.4
   */
  async handleReversal(
    userId: string,
    chargeId: string,
    reversedAt: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      // 1. Fetch the subscription (Req 25.1)
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });
      if (!sub) throw new SubscriptionNotFoundError(userId);

      // 2. Look up the original charge to determine the charge timestamp
      //    (Req 25.1: "look up the corresponding charge timestamp")
      const payment = await tx.query.payments.findFirst({
        where: and(
          eq(payments.userId, userId),
          eq(payments.providerRef, chargeId),
        ),
      });

      // Determine the charge date: use chargedAt from the payments record
      // if available, otherwise fall back to reversedAt (conservative — treats
      // as same-day reversal, which is within 7 days).
      const chargedAt: Date = payment?.chargedAt ?? reversedAt;

      // 3. Calculate days between charge and reversal (Req 25.1, 25.2, 25.3)
      const daysSinceCharge = Math.floor(
        (reversedAt.getTime() - chargedAt.getTime()) / (24 * 60 * 60 * 1000),
      );

      if (daysSinceCharge < 7) {
        // ── Path A: < 7 days — roll back tier to creator (Req 25.2) ──────────

        // Roll back tier to creator, clear pending_tier, set status active
        await tx
          .update(subscriptions)
          .set({
            tier: 'creator',
            status: 'active',
            pendingTier: null,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.id));

        // Reset all usage counters (Req 25.2: "reset Usage_Counters and
        // Concurrent State counts")
        await tx.delete(usageCounters).where(eq(usageCounters.userId, userId));

        // Mark the payment as reversed
        if (payment) {
          await tx
            .update(payments)
            .set({ status: 'reversed', reversedAt, updatedAt: new Date() })
            .where(eq(payments.id, payment.id));
        }

        // Append audit event (Req 25.2, 24.2)
        await this.subscriptionEventsRepository.append(tx, {
          userId,
          subscriptionId: sub.id,
          eventType: 'payment_reversed',
          actorType: 'system',
          beforeSnapshot: sub as Record<string, unknown>,
          reason: `Payment reversed within 7 days (daysSinceCharge=${daysSinceCharge}) — tier rolled back to creator`,
        });

        // Schedule notification (Req 25.2, 26.x)
        await this.notificationsService.scheduleInTx(tx, {
          type: 'in_app',
          payload: {
            userId,
            type: 'payment_reversed_rollback',
            tier: 'creator',
            chargeId,
            reversedAt: reversedAt.toISOString(),
          },
          idempotencyKey: `payment_reversed_rollback:${sub.id}:${chargeId}`,
        });
      } else {
        // ── Path B: ≥ 7 days — set payment_owed = true (Req 25.3) ───────────

        // Retain active tier; mark payment_owed = true to suspend purchases
        await tx
          .update(subscriptions)
          .set({ paymentOwed: true, updatedAt: new Date() })
          .where(eq(subscriptions.id, sub.id));

        // Mark the payment as reversed
        if (payment) {
          await tx
            .update(payments)
            .set({ status: 'reversed', reversedAt, updatedAt: new Date() })
            .where(eq(payments.id, payment.id));
        }

        // Append audit event (Req 25.3, 24.2)
        await this.subscriptionEventsRepository.append(tx, {
          userId,
          subscriptionId: sub.id,
          eventType: 'payment_reversed',
          actorType: 'system',
          beforeSnapshot: sub as Record<string, unknown>,
          reason: `Payment reversed after 7 days (daysSinceCharge=${daysSinceCharge}) — payment_owed set, purchases suspended`,
        });

        // Schedule notification (Req 25.3, 26.x)
        await this.notificationsService.scheduleInTx(tx, {
          type: 'in_app',
          payload: {
            userId,
            type: 'payment_owed',
            chargeId,
            reversedAt: reversedAt.toISOString(),
          },
          idempotencyKey: `payment_owed:${sub.id}:${chargeId}`,
        });
      }
    });
  }

  /**
   * Handles a payment reversal for an add-on purchase.
   *
   * When the Payment Service reports a reversal (chargeback, refund, network reversal)
   * for an add_on_purchases charge, this method:
   *   1. Finds the add-on purchase by id + userId (no-ops if already reversed/not found)
   *   2. Sets status to 'canceled'
   *   3. Terminates any active boost immediately by setting effectiveEnd to now()
   *      so that PromotionService.isBoostActive returns false right away
   *   4. Appends an addon_canceled audit event in the same transaction
   *
   * Requirements: 25.5
   */
  async handleAddonReversal(userId: string, addonPurchaseId: string): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      // 1. Find the add-on purchase
      const purchase = await tx.query.addOnPurchases.findFirst({
        where: and(
          eq(addOnPurchases.id, addonPurchaseId),
          eq(addOnPurchases.userId, userId),
        ),
      });

      if (!purchase) return; // Already reversed or not found

      // 2. Set status to 'canceled'; if this is an active boost, also terminate
      //    the benefit window immediately by setting effectiveEnd = now (Req 25.5)
      const now = new Date();
      const updateFields: Record<string, unknown> = {
        status: 'canceled',
        updatedAt: now,
      };

      if (purchase.addonId === 'boost' && purchase.status === 'active') {
        // Terminate the boost benefit window so PromotionService.isBoostActive
        // returns false immediately (Req 25.5: "revoke any in-progress benefits")
        updateFields.effectiveEnd = now;
      }

      await tx
        .update(addOnPurchases)
        .set(updateFields)
        .where(eq(addOnPurchases.id, addonPurchaseId));

      // 3. Append audit event
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

      await this.subscriptionEventsRepository.append(tx, {
        userId,
        subscriptionId: sub?.id,
        eventType: 'addon_canceled',
        actorType: 'system',
        beforeSnapshot: purchase as Record<string, unknown>,
        reason: 'Payment reversed — add-on canceled',
      });
    });
  }

  /**
   * Cancels the authenticated user's subscription.
   *
   * Sets status to `canceling` without changing the active tier or usage
   * counters. The subscription remains active until `current_period_end`,
   * at which point the period-advance scheduler reverts the tier to `creator`.
   *
   * Validation:
   *   - Subscription must exist.
   *   - Status must be `active` (already `canceling` is a no-op guard).
   *
   * Appends a `cancellation_requested` audit event in the same transaction
   * (Requirements 8.1, 8.8, 24.1).
   *
   * Requirements: 8.1, 8.3, 8.8
   */
  async cancel(userId: string): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

      if (!sub) {
        throw new SubscriptionNotFoundError(userId);
      }

      // Already canceling — idempotent no-op
      if (sub.status === 'canceling') {
        return;
      }

      // Set status to canceling; tier and counters are unchanged (Req 8.1)
      const [updated] = await tx
        .update(subscriptions)
        .set({ status: 'canceling', updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id))
        .returning();

      // Append audit event (Req 8.8, 24.1)
      await this.subscriptionEventsRepository.append(tx, {
        userId,
        subscriptionId: sub.id,
        eventType: 'cancellation_requested',
        actorType: 'user',
        beforeSnapshot: sub as Record<string, unknown>,
        afterSnapshot: updated as Record<string, unknown>,
        reason: `Cancellation requested; effective at ${sub.currentPeriodEnd.toISOString()}`,
      });
    });
  }

  /**
   * Resumes a subscription that is in `canceling` status.
   *
   * Reverts status from `canceling` back to `active`, retaining the existing
   * tier, `current_period_end`, and usage counters unchanged.
   *
   * Validation:
   *   - Subscription must exist.
   *   - Status must be `canceling`; any other status is rejected.
   *
   * Appends a `cancellation_resumed` audit event in the same transaction
   * (Requirements 8.3, 8.8, 24.1).
   *
   * Requirements: 8.1, 8.3, 8.8
   */
  async resume(userId: string): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

      if (!sub) {
        throw new SubscriptionNotFoundError(userId);
      }

      if (sub.status !== 'canceling') {
        throw new InvalidDowngradeTargetError(
          `Cannot resume a subscription with status "${sub.status}" — only "canceling" subscriptions can be resumed`,
        );
      }

      // Revert to active; period and counters are unchanged (Req 8.3)
      const [updated] = await tx
        .update(subscriptions)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id))
        .returning();

      // Append audit event (Req 8.8, 24.1)
      await this.subscriptionEventsRepository.append(tx, {
        userId,
        subscriptionId: sub.id,
        eventType: 'cancellation_resumed',
        actorType: 'user',
        beforeSnapshot: sub as Record<string, unknown>,
        afterSnapshot: updated as Record<string, unknown>,
        reason: 'Cancellation reversed by user before period end',
      });
    });
  }

  /**
   * Handles a renewal charge failure reported by the Payment Service via webhook.
   *
   * Sets the subscription status to `payment_failed`, retaining the active tier
   * and all usage counters so the user keeps paid-tier access during the grace
   * window. The period-advance scheduler will drive the retry schedule
   * (+24h, +48h, +72h) and eventual lapse if all retries fail.
   *
   * Idempotent: if the subscription is already `payment_failed`, the call is a
   * no-op (the scheduler owns the retry state machine from that point).
   *
   * Requirements: 23.2
   */
  async handleRenewalFailed(userId: string): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

      if (!sub) throw new SubscriptionNotFoundError(userId);

      // Idempotent: already in payment_failed state — scheduler owns retries
      if (sub.status === 'payment_failed') return;

      const [updated] = await tx
        .update(subscriptions)
        .set({ status: 'payment_failed', updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id))
        .returning();

      // Append audit event (Req 23.2, 24.2)
      await this.subscriptionEventsRepository.append(tx, {
        userId,
        subscriptionId: sub.id,
        eventType: 'renewal_failed',
        actorType: 'system',
        beforeSnapshot: sub as Record<string, unknown>,
        afterSnapshot: updated as Record<string, unknown>,
        reason: 'Renewal charge failed — status set to payment_failed, grace window started',
      });

      // Notify user within 60 seconds (Req 23.2, 26.3)
      await this.notificationsService.scheduleInTx(tx, {
        type: 'in_app',
        payload: {
          userId,
          type: 'renewal_failed',
          tier: sub.tier,
        },
        idempotencyKey: `renewal_failed:${sub.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    });
  }

  /**
   * Schedules a downgrade to a lower tier, effective at `current_period_end`.
   *
   * Records the target as `pending_tier` without changing the active tier.
   * The actual tier change is applied by the period-advance scheduler when
   * `current_period_end` is reached.
   *
   * Validation rules (Requirement 7.2):
   *   - Target tier rank must be strictly lower than the active tier rank.
   *   - Target tier must not equal the existing `pending_tier`.
   *
   * Appends a `tier_downgrade_requested` audit event in the same transaction
   * (Requirements 7.8, 24.1).
   *
   * Requirements: 7.1, 7.2, 7.5, 7.7, 7.8
   */
  async scheduleDowngrade(userId: string, targetTier: 'creator' | 'growth'): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

      if (!sub) {
        throw new SubscriptionNotFoundError(userId);
      }

      // Validate: target must be strictly lower rank than current tier (Req 7.2)
      if (tierRank(targetTier as Tier) >= tierRank(sub.tier as Tier)) {
        throw new InvalidDowngradeTargetError(
          'Target tier must be strictly lower rank than current tier',
        );
      }

      // Validate: target must not equal existing pending_tier (Req 7.2)
      if (sub.pendingTier === targetTier) {
        throw new InvalidDowngradeTargetError(
          'Target tier equals existing pending_tier',
        );
      }

      // Set pending_tier — effective at current_period_end (Req 7.1)
      const [updated] = await tx
        .update(subscriptions)
        .set({ pendingTier: targetTier, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id))
        .returning();

      // Append audit event (Req 7.8, 24.1)
      await this.subscriptionEventsRepository.append(tx, {
        userId,
        subscriptionId: sub.id,
        eventType: 'tier_downgrade_requested',
        actorType: 'user',
        beforeSnapshot: sub,
        afterSnapshot: updated,
        reason: `Scheduled downgrade to ${targetTier} at ${sub.currentPeriodEnd.toISOString()}`,
      });
    });
  }
}
