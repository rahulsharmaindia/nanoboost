// ── PeriodAdvanceScheduler ────────────────────────────────────────────────
//
// Runs every 60 seconds and advances subscriptions whose current_period_end
// has been reached. Uses a processing_started_at lease column to prevent
// concurrent processing across multiple server instances.
//
// Processing paths per subscription status:
//   'canceling'      → revert to creator tier, reset counters, set 'canceled'
//   'active' + pending_tier → apply scheduled downgrade (charge new price)
//   'active' + no pending   → attempt renewal charge
//   'payment_failed' → run scheduled retry (24h / 48h / 72h windows)
//
// On success: advance period 30 days, reset usage counters.
// On failure: status → 'payment_failed' (or 'lapsed' after 3 retries).
//
// Requirements: 4.2, 4.3, 4.7, 7.3, 7.4, 8.2, 23.1

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, isNull, lte, or, lt } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../database/database.module';
import { subscriptions } from '../../../database/schema/subscriptions.schema';
import { usageCounters } from '../../../database/schema/usage_counters.schema';
import { payments } from '../../../database/schema/payments.schema';
import { inboundProposals } from '../../../database/schema/inbound_proposals.schema';
import { PaymentPort } from '../ports/payment.port';
import { PlansCatalogService } from '../plans-catalog.service';
import { SubscriptionEventsRepository } from '../subscription-events.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import type { Subscription } from '../../../database/schema/subscriptions.schema';

// ── Constants ─────────────────────────────────────────────────────────────

/** How often the scheduler runs (ms). */
const CRON_INTERVAL_MS = 60_000;

/** Lease expiry — a processing_started_at older than this is considered stale. */
const LEASE_EXPIRY_MS = 5 * 60_000; // 5 minutes

/** Period length in days (Req 4.1). */
const PERIOD_DAYS = 30;

/** Retry windows in hours after first payment failure (Req 23.2). */
const RETRY_HOURS = [24, 48, 72] as const;

/** Number of retries before lapsing (Req 23.4). */
const MAX_RETRIES = 3;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Add `days` calendar days to a Date, returning a new Date. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Add `hours` to a Date, returning a new Date. */
function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Determine which retry attempt this is (0-indexed) based on how many hours
 * have elapsed since the subscription first entered payment_failed status.
 * Returns -1 if no retry window has been reached yet.
 */
function retryAttemptIndex(failedAt: Date, now: Date): number {
  const elapsedHours = (now.getTime() - failedAt.getTime()) / (60 * 60 * 1000);
  for (let i = RETRY_HOURS.length - 1; i >= 0; i--) {
    if (elapsedHours >= RETRY_HOURS[i]) return i;
  }
  return -1;
}

// ── Scheduler ─────────────────────────────────────────────────────────────

@Injectable()
export class PeriodAdvanceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PeriodAdvanceScheduler.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly paymentPort: PaymentPort,
    private readonly plansCatalogService: PlansCatalogService,
    private readonly subscriptionEventsRepository: SubscriptionEventsRepository,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      this.advanceDuePeriods().catch((err: Error) => {
        this.logger.error(`advanceDuePeriods top-level error: ${err.message}`, err.stack);
      });
    }, CRON_INTERVAL_MS);

    this.logger.log(`PeriodAdvanceScheduler started (interval: ${CRON_INTERVAL_MS}ms)`);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log('PeriodAdvanceScheduler stopped');
    }
  }

  // ── Main entry point ──────────────────────────────────────────────────

  /**
   * Find all subscriptions due for period advance and process each one.
   *
   * Uses a processing_started_at lease to prevent concurrent processing:
   *   WHERE (processing_started_at IS NULL
   *          OR processing_started_at < now() - 5min)
   *     AND current_period_end <= now()
   *     AND status IN ('active', 'canceling', 'payment_failed')
   *
   * Requirements: 4.2, 4.3, 7.3, 7.4, 8.2, 23.1
   */
  async advanceDuePeriods(now = new Date()): Promise<void> {
    const leaseExpiry = new Date(now.getTime() - LEASE_EXPIRY_MS);

    // Claim rows by setting processing_started_at atomically.
    // Only rows with no lease or an expired lease are eligible.
    const claimed = await this.db
      .update(subscriptions)
      .set({ processingStartedAt: now })
      .where(
        and(
          lte(subscriptions.currentPeriodEnd, now),
          or(
            isNull(subscriptions.processingStartedAt),
            lt(subscriptions.processingStartedAt, leaseExpiry),
          ),
          or(
            eq(subscriptions.status, 'active'),
            eq(subscriptions.status, 'canceling'),
            eq(subscriptions.status, 'payment_failed'),
          ),
        ),
      )
      .returning();

    if (claimed.length === 0) return;

    this.logger.log(`Processing ${claimed.length} due subscription(s)`);

    for (const sub of claimed as Subscription[]) {
      await this.processSubscription(sub, now);
    }
  }

  // ── Per-subscription dispatch ─────────────────────────────────────────

  /**
   * Process a single subscription in its own transaction.
   * Routes to the appropriate path based on status and pending_tier.
   */
  private async processSubscription(sub: Subscription, now: Date): Promise<void> {
    try {
      await this.db.transaction(async (tx: any) => {
        // Re-fetch inside the transaction to get the latest state
        // (another instance may have processed it between claim and here).
        const fresh = await tx.query.subscriptions.findFirst({
          where: eq(subscriptions.id, sub.id),
        });

        if (!fresh) return; // Deleted between claim and processing

        // Guard: if another instance already cleared the lease and advanced
        // the period, skip (period end is now in the future).
        if (fresh.currentPeriodEnd > now) {
          await this.releaseLease(tx, sub.id);
          return;
        }

        if (fresh.status === 'canceling') {
          await this.applyCancellation(tx, fresh, now);
        } else if (fresh.status === 'active' && fresh.pendingTier) {
          await this.applyDowngrade(tx, fresh, now);
        } else if (fresh.status === 'active') {
          await this.applyRenewal(tx, fresh, now);
        } else if (fresh.status === 'payment_failed') {
          await this.applyRetry(tx, fresh, now);
        } else {
          // Unexpected status — release lease and skip
          await this.releaseLease(tx, sub.id);
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to process subscription ${sub.id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Release the lease so the next run can retry
      await this.db
        .update(subscriptions)
        .set({ processingStartedAt: null, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id))
        .catch((releaseErr: Error) => {
          this.logger.error(
            `Failed to release lease for subscription ${sub.id}: ${releaseErr.message}`,
          );
        });
    }
  }

  // ── Path: cancellation apply ──────────────────────────────────────────

  /**
   * Apply a pending cancellation at period end.
   *
   * Atomically:
   *   - Change tier to 'creator'
   *   - Set status to 'canceled'
   *   - Clear pending_tier
   *   - Reset usage counters to 0 (delete rows for this user)
   *   - Advance period 30 days
   *   - Append cancellation_applied audit event
   *   - Notify user
   *
   * Requirements: 8.2, 4.7
   */
  private async applyCancellation(tx: any, sub: Subscription, now: Date): Promise<void> {
    const nextStart = sub.currentPeriodEnd;
    const nextEnd = addDays(nextStart, PERIOD_DAYS);

    const [updated] = await tx
      .update(subscriptions)
      .set({
        tier: 'creator',
        status: 'canceled',
        pendingTier: null,
        currentPeriodStart: nextStart,
        currentPeriodEnd: nextEnd,
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, sub.id))
      .returning();

    // Reset usage counters (Req 4.7, 8.2)
    await tx.delete(usageCounters).where(eq(usageCounters.userId, sub.userId));

    // Audit event (Req 24.1)
    await this.subscriptionEventsRepository.append(tx, {
      userId: sub.userId,
      subscriptionId: sub.id,
      eventType: 'cancellation_applied',
      actorType: 'system',
      beforeSnapshot: sub as Record<string, unknown>,
      afterSnapshot: updated as Record<string, unknown>,
      reason: 'Subscription period ended with status canceling — reverted to creator tier',
    });

    // Notification (Req 26.x)
    await this.notificationsService.scheduleInTx(tx, {
      type: 'in_app',
      payload: {
        userId: sub.userId,
        type: 'subscription_canceled',
        tier: 'creator',
        effectiveAt: nextStart.toISOString(),
      },
      idempotencyKey: `cancellation_applied:${sub.id}:${nextStart.toISOString()}`,
    });

    this.logger.log(`Subscription ${sub.id} (user ${sub.userId}): cancellation applied → creator`);
  }

  // ── Path: downgrade apply ─────────────────────────────────────────────

  /**
   * Apply a scheduled downgrade at period end.
   *
   * Atomically:
   *   - Change tier to pending_tier
   *   - Clear pending_tier
   *   - Charge new tier price (skip if new tier is 'creator')
   *   - Reset usage counters
   *   - Advance period 30 days
   *   - Append tier_downgrade_applied audit event
   *   - Notify user
   *
   * On charge failure: fall through to renewal failure handling.
   *
   * Requirements: 7.3, 7.4, 4.2, 4.3
   */
  private async applyDowngrade(tx: any, sub: Subscription, now: Date): Promise<void> {
    const newTier = sub.pendingTier as 'creator' | 'growth';
    const nextStart = sub.currentPeriodEnd;
    const nextEnd = addDays(nextStart, PERIOD_DAYS);

    // Charge new tier price (skip for creator — it's free)
    if (newTier !== 'creator') {
      const { plan } = await this.plansCatalogService.getPlan(newTier, sub.locale as 'IN' | 'US');
      const idempotencyKey = `downgrade_renewal:${sub.id}:${newTier}:${nextStart.toISOString()}`;

      const charge = await this.paymentPort.charge({
        userId: sub.userId,
        amountMinor: plan.priceMinorUnits,
        currency: plan.currency,
        idempotencyKey,
        description: `Subscription renewal after downgrade to ${newTier}`,
      });

      if (!charge.success) {
        // Charge failed — treat as renewal failure (Req 7.4)
        await this.handleChargeFailure(tx, sub, now, 'downgrade_renewal_failed');
        return;
      }

      // Record the payment
      await this.recordPayment(tx, sub.userId, plan.priceMinorUnits, plan.currency, charge.providerRef, idempotencyKey);
    }

    const [updated] = await tx
      .update(subscriptions)
      .set({
        tier: newTier,
        pendingTier: null,
        status: 'active',
        currentPeriodStart: nextStart,
        currentPeriodEnd: nextEnd,
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, sub.id))
      .returning();

    // Reset usage counters (Req 4.3)
    await tx.delete(usageCounters).where(eq(usageCounters.userId, sub.userId));

    // Release up to 3 oldest held proposals under the new period (Req 5.8)
    await this.releaseHeldProposals(tx, sub.userId);

    // Audit event (Req 24.1)
    await this.subscriptionEventsRepository.append(tx, {
      userId: sub.userId,
      subscriptionId: sub.id,
      eventType: 'tier_downgrade_applied',
      actorType: 'system',
      beforeSnapshot: sub as Record<string, unknown>,
      afterSnapshot: updated as Record<string, unknown>,
      reason: `Scheduled downgrade from ${sub.tier} to ${newTier} applied at period end`,
    });

    // Notification
    await this.notificationsService.scheduleInTx(tx, {
      type: 'in_app',
      payload: {
        userId: sub.userId,
        type: 'downgrade_applied',
        fromTier: sub.tier,
        toTier: newTier,
        effectiveAt: nextStart.toISOString(),
      },
      idempotencyKey: `downgrade_applied:${sub.id}:${nextStart.toISOString()}`,
    });

    this.logger.log(`Subscription ${sub.id} (user ${sub.userId}): downgrade applied ${sub.tier} → ${newTier}`);
  }

  // ── Path: renewal ─────────────────────────────────────────────────────

  /**
   * Attempt renewal charge for an active subscription with no pending changes.
   *
   * On success: advance period 30 days, reset usage counters, emit renewal_succeeded.
   * On failure: set status to 'payment_failed', emit renewal_failed.
   *
   * Creator tier (price = 0) is renewed without a charge.
   *
   * Requirements: 4.2, 4.3, 23.1
   */
  private async applyRenewal(tx: any, sub: Subscription, now: Date): Promise<void> {
    const nextStart = sub.currentPeriodEnd;
    const nextEnd = addDays(nextStart, PERIOD_DAYS);

    const { plan } = await this.plansCatalogService.getPlan(
      sub.tier as 'creator' | 'growth' | 'studio',
      sub.locale as 'IN' | 'US',
    );

    // Creator tier is free — no charge needed
    if (plan.priceMinorUnits > 0) {
      const idempotencyKey = `renewal:${sub.id}:${nextStart.toISOString()}`;

      const charge = await this.paymentPort.charge({
        userId: sub.userId,
        amountMinor: plan.priceMinorUnits,
        currency: plan.currency,
        idempotencyKey,
        description: `Subscription renewal — ${sub.tier} tier`,
      });

      if (!charge.success) {
        await this.handleChargeFailure(tx, sub, now, 'renewal_failed');
        return;
      }

      await this.recordPayment(tx, sub.userId, plan.priceMinorUnits, plan.currency, charge.providerRef, idempotencyKey);
    }

    const [updated] = await tx
      .update(subscriptions)
      .set({
        status: 'active',
        currentPeriodStart: nextStart,
        currentPeriodEnd: nextEnd,
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, sub.id))
      .returning();

    // Reset usage counters (Req 4.2, 4.3)
    await tx.delete(usageCounters).where(eq(usageCounters.userId, sub.userId));

    // Release up to 3 oldest held proposals under the new period (Req 5.8)
    await this.releaseHeldProposals(tx, sub.userId);

    // Audit event
    await this.subscriptionEventsRepository.append(tx, {
      userId: sub.userId,
      subscriptionId: sub.id,
      eventType: 'renewal_succeeded',
      actorType: 'system',
      beforeSnapshot: sub as Record<string, unknown>,
      afterSnapshot: updated as Record<string, unknown>,
      reason: `Period renewed — new period ${nextStart.toISOString()} to ${nextEnd.toISOString()}`,
    });

    // Notification
    await this.notificationsService.scheduleInTx(tx, {
      type: 'email',
      payload: {
        userId: sub.userId,
        templateId: 'receipt',
        tier: sub.tier,
        periodStart: nextStart.toISOString(),
        periodEnd: nextEnd.toISOString(),
      },
      idempotencyKey: `renewal_receipt:${sub.id}:${nextStart.toISOString()}`,
    });

    this.logger.log(`Subscription ${sub.id} (user ${sub.userId}): renewal succeeded`);
  }

  // ── Path: payment_failed retry ────────────────────────────────────────

  /**
   * Run a scheduled retry for a subscription in payment_failed status.
   *
   * Retry windows: +24h, +48h, +72h after the first failure.
   * After 3 failed retries: lapse → revert to creator tier, reset counters.
   *
   * The "failed since" timestamp is derived from the subscription's
   * current_period_end (the moment the first failure was recorded).
   *
   * Requirements: 23.2, 23.3, 23.4, 23.5
   */
  private async applyRetry(tx: any, sub: Subscription, now: Date): Promise<void> {
    // Use current_period_end as the "failed since" anchor — it was set to
    // the original period end when the first failure occurred.
    const failedAt = sub.currentPeriodEnd;
    const attemptIndex = retryAttemptIndex(failedAt, now);

    if (attemptIndex < 0) {
      // No retry window reached yet — release lease and wait
      await this.releaseLease(tx, sub.id);
      return;
    }

    const { plan } = await this.plansCatalogService.getPlan(
      sub.tier as 'creator' | 'growth' | 'studio',
      sub.locale as 'IN' | 'US',
    );

    const idempotencyKey = `retry:${sub.id}:attempt${attemptIndex + 1}:${failedAt.toISOString()}`;

    const charge = await this.paymentPort.charge({
      userId: sub.userId,
      amountMinor: plan.priceMinorUnits,
      currency: plan.currency,
      idempotencyKey,
      description: `Subscription renewal retry (attempt ${attemptIndex + 1}) — ${sub.tier} tier`,
    });

    if (charge.success) {
      // Retry succeeded — advance period and reset counters
      const nextStart = sub.currentPeriodEnd;
      const nextEnd = addDays(nextStart, PERIOD_DAYS);

      await this.recordPayment(tx, sub.userId, plan.priceMinorUnits, plan.currency, charge.providerRef, idempotencyKey);

      const [updated] = await tx
        .update(subscriptions)
        .set({
          status: 'active',
          currentPeriodStart: nextStart,
          currentPeriodEnd: nextEnd,
          processingStartedAt: null,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id))
        .returning();

      await tx.delete(usageCounters).where(eq(usageCounters.userId, sub.userId));

      await this.subscriptionEventsRepository.append(tx, {
        userId: sub.userId,
        subscriptionId: sub.id,
        eventType: 'payment_retry_succeeded',
        actorType: 'system',
        beforeSnapshot: sub as Record<string, unknown>,
        afterSnapshot: updated as Record<string, unknown>,
        reason: `Payment retry attempt ${attemptIndex + 1} succeeded`,
      });

      await this.notificationsService.scheduleInTx(tx, {
        type: 'email',
        payload: {
          userId: sub.userId,
          templateId: 'receipt',
          tier: sub.tier,
          periodStart: nextStart.toISOString(),
          periodEnd: nextEnd.toISOString(),
        },
        idempotencyKey: `retry_receipt:${sub.id}:${nextStart.toISOString()}`,
      });

      this.logger.log(`Subscription ${sub.id} (user ${sub.userId}): retry attempt ${attemptIndex + 1} succeeded`);
      return;
    }

    // Retry failed
    if (attemptIndex >= MAX_RETRIES - 1) {
      // All retries exhausted — lapse the subscription (Req 23.4, 23.5)
      await this.applyLapse(tx, sub, now, attemptIndex + 1);
    } else {
      // More retries remain — stay in payment_failed, schedule next retry
      const nextRetryAt = addHours(failedAt, RETRY_HOURS[attemptIndex + 1]);

      await tx
        .update(subscriptions)
        .set({ processingStartedAt: null, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));

      await this.subscriptionEventsRepository.append(tx, {
        userId: sub.userId,
        subscriptionId: sub.id,
        eventType: 'renewal_failed',
        actorType: 'system',
        beforeSnapshot: sub as Record<string, unknown>,
        reason: `Payment retry attempt ${attemptIndex + 1} failed — next retry at ${nextRetryAt.toISOString()}`,
      });

      await this.notificationsService.scheduleInTx(tx, {
        type: 'in_app',
        payload: {
          userId: sub.userId,
          type: 'payment_failed',
          attemptNumber: attemptIndex + 1,
          nextRetryAt: nextRetryAt.toISOString(),
        },
        idempotencyKey: `payment_failed:${sub.id}:attempt${attemptIndex + 1}`,
      });

      this.logger.warn(`Subscription ${sub.id} (user ${sub.userId}): retry attempt ${attemptIndex + 1} failed`);
    }
  }

  // ── Path: lapse ───────────────────────────────────────────────────────

  /**
   * Lapse a subscription after all retries are exhausted.
   *
   * Atomically:
   *   - Revert tier to 'creator'
   *   - Set status to 'lapsed'
   *   - Reset usage counters
   *   - Emit subscription_lapsed event
   *   - Notify user
   *
   * Requirements: 23.4, 23.5, 23.6, 23.7
   */
  private async applyLapse(tx: any, sub: Subscription, now: Date, attemptNumber: number): Promise<void> {
    const [updated] = await tx
      .update(subscriptions)
      .set({
        tier: 'creator',
        status: 'lapsed',
        pendingTier: null,
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, sub.id))
      .returning();

    // Reset usage counters (Req 23.5)
    await tx.delete(usageCounters).where(eq(usageCounters.userId, sub.userId));

    // Release up to 3 oldest held proposals (Req 23.5 → Req 5.8).
    // The user reverts to creator tier, but the held queue is preserved
    // and the oldest proposals are dispatched under the new period so
    // brand outreach is not silently lost.
    await this.releaseHeldProposals(tx, sub.userId);

    await this.subscriptionEventsRepository.append(tx, {
      userId: sub.userId,
      subscriptionId: sub.id,
      eventType: 'subscription_lapsed',
      actorType: 'system',
      beforeSnapshot: sub as Record<string, unknown>,
      afterSnapshot: updated as Record<string, unknown>,
      reason: `All ${attemptNumber} payment retries exhausted — subscription lapsed, reverted to creator tier`,
    });

    await this.notificationsService.scheduleInTx(tx, {
      type: 'email',
      payload: {
        userId: sub.userId,
        templateId: 'subscription_lapsed',
        fromTier: sub.tier,
        attemptNumber,
      },
      idempotencyKey: `subscription_lapsed:${sub.id}:${now.toISOString()}`,
    });

    await this.notificationsService.scheduleInTx(tx, {
      type: 'in_app',
      payload: {
        userId: sub.userId,
        type: 'subscription_lapsed',
        fromTier: sub.tier,
      },
      idempotencyKey: `subscription_lapsed_inapp:${sub.id}:${now.toISOString()}`,
    });

    this.logger.warn(
      `Subscription ${sub.id} (user ${sub.userId}): lapsed after ${attemptNumber} failed retries — reverted to creator`,
    );
  }

  // ── Shared helpers ────────────────────────────────────────────────────

  /**
   * Release up to 3 oldest `held_for_upgrade` proposals to `delivered`
   * for the given user, within the caller's transaction.
   *
   * Called after usage counters are reset at period end so the new period's
   * fresh counter capacity can absorb the released proposals.
   *
   * Each released proposal triggers an in-app notification to the creator.
   *
   * Requirements: 5.7, 5.8
   */
  private async releaseHeldProposals(tx: any, userId: string): Promise<void> {
    // Find up to 3 oldest held proposals for this user, ordered by created_at ASC
    const held = await tx
      .select()
      .from(inboundProposals)
      .where(
        and(
          eq(inboundProposals.creatorUserId, userId),
          eq(inboundProposals.status, 'held_for_upgrade'),
        ),
      )
      .orderBy(asc(inboundProposals.createdAt))
      .limit(3);

    if (held.length === 0) return;

    const now = new Date();

    for (const proposal of held) {
      // Update status to delivered
      await tx
        .update(inboundProposals)
        .set({ status: 'delivered', updatedAt: now })
        .where(eq(inboundProposals.id, proposal.id));

      // Notify the creator about each released proposal
      await this.notificationsService.scheduleInTx(tx, {
        type: 'in_app',
        payload: {
          userId,
          type: 'proposal_released',
          proposalId: proposal.id,
          brandName: proposal.brandName,
          budgetRange: proposal.budgetRange,
          deliverables: proposal.deliverables,
        },
        idempotencyKey: `proposal_released:${proposal.id}:${now.toISOString()}`,
      });
    }

    this.logger.log(
      `Released ${held.length} held proposal(s) for user ${userId} at period end`,
    );
  }

  /**
   * Handle a charge failure for an active subscription (first failure).
   * Sets status to 'payment_failed' and emits renewal_failed event.
   * The current_period_end is NOT advanced — it serves as the "failed since"
   * anchor for retry window calculations.
   *
   * Requirements: 23.2, 23.3
   */
  private async handleChargeFailure(
    tx: any,
    sub: Subscription,
    now: Date,
    reason: string,
  ): Promise<void> {
    const [updated] = await tx
      .update(subscriptions)
      .set({
        status: 'payment_failed',
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, sub.id))
      .returning();

    await this.subscriptionEventsRepository.append(tx, {
      userId: sub.userId,
      subscriptionId: sub.id,
      eventType: 'renewal_failed',
      actorType: 'system',
      beforeSnapshot: sub as Record<string, unknown>,
      afterSnapshot: updated as Record<string, unknown>,
      reason: `${reason} — status set to payment_failed, retries scheduled at +24h/+48h/+72h`,
    });

    await this.notificationsService.scheduleInTx(tx, {
      type: 'email',
      payload: {
        userId: sub.userId,
        templateId: 'payment_failed',
        tier: sub.tier,
        retryAt: addHours(sub.currentPeriodEnd, RETRY_HOURS[0]).toISOString(),
      },
      idempotencyKey: `payment_failed_email:${sub.id}:${sub.currentPeriodEnd.toISOString()}`,
    });

    await this.notificationsService.scheduleInTx(tx, {
      type: 'in_app',
      payload: {
        userId: sub.userId,
        type: 'payment_failed',
        attemptNumber: 0,
        nextRetryAt: addHours(sub.currentPeriodEnd, RETRY_HOURS[0]).toISOString(),
      },
      idempotencyKey: `payment_failed_inapp:${sub.id}:${sub.currentPeriodEnd.toISOString()}`,
    });

    this.logger.warn(`Subscription ${sub.id} (user ${sub.userId}): ${reason}`);
  }

  /**
   * Record a successful payment in the payments table.
   */
  private async recordPayment(
    tx: any,
    userId: string,
    amountMinorUnits: number,
    currency: string,
    providerRef: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    await tx.insert(payments).values({
      userId,
      amountMinorUnits,
      currency,
      providerRef: providerRef ?? null,
      status: 'succeeded',
      idempotencyKey,
      chargedAt: new Date(),
    }).onConflictDoNothing();
  }

  /**
   * Release the processing lease without making any other changes.
   * Used when a row is skipped (e.g. already processed by another instance).
   */
  private async releaseLease(tx: any, subscriptionId: string): Promise<void> {
    await tx
      .update(subscriptions)
      .set({ processingStartedAt: null, updatedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId));
  }
}
