// ── AddonRenewalScheduler ─────────────────────────────────────────────────
//
// Runs every 60 seconds and renews recurring add-on purchases whose
// current_period_end has been reached. Uses a processing_started_at lease
// column to prevent concurrent processing across multiple server instances.
//
// Processing paths per add-on status:
//   'active'         → attempt renewal charge; on success advance period 30 days
//                      and reset consumption counters
//   'canceling'      → set status to 'canceled' (no charge, access period ended)
//   'payment_failed' → run scheduled retry (+24h / +48h / +72h windows)
//
// On success: advance period 30 days, reset consumption counters.
// On failure: status → 'payment_failed' (or 'lapsed' after 3 retries).
//
// Requirements: 14.2, 14.3, 14.4

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, lte, or, lt } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../database/database.module';
import { addOnPurchases } from '../../../database/schema/add_on_purchases.schema';
import type { AddOnPurchase } from '../../../database/schema/add_on_purchases.schema';
import { payments } from '../../../database/schema/payments.schema';
import { PaymentPort } from '../ports/payment.port';
import { SubscriptionEventsRepository } from '../subscription-events.repository';
import { NotificationsService } from '../../notifications/notifications.service';

// ── Constants ─────────────────────────────────────────────────────────────

/** How often the scheduler runs (ms). */
const CRON_INTERVAL_MS = 60_000;

/** Lease expiry — a processing_started_at older than this is considered stale. */
const LEASE_EXPIRY_MS = 5 * 60_000; // 5 minutes

/** Period length in days for recurring add-ons (Req 14.1). */
const PERIOD_DAYS = 30;

/** Retry windows in hours after first payment failure (Req 14.4). */
const RETRY_HOURS = [24, 48, 72] as const;

/** Number of retries before lapsing (Req 14.4). */
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
 * have elapsed since the add-on first entered payment_failed status.
 * Returns -1 if no retry window has been reached yet.
 */
function retryAttemptIndex(failedAt: Date, now: Date): number {
  const elapsedHours = (now.getTime() - failedAt.getTime()) / (60 * 60 * 1000);
  for (let i = RETRY_HOURS.length - 1; i >= 0; i--) {
    if (elapsedHours >= RETRY_HOURS[i]) return i;
  }
  return -1;
}

/**
 * Return the initial consumption counters for an add-on (reset to zero).
 * content_studio_pack tracks videoEditsUsed and scriptsUsed (Req 12.5).
 * ai_growth_pack uses an empty object.
 */
function resetCounters(addonId: string): Record<string, number> {
  if (addonId === 'content_studio_pack') {
    return { videoEditsUsed: 0, scriptsUsed: 0 };
  }
  return {};
}

// ── Scheduler ─────────────────────────────────────────────────────────────

@Injectable()
export class AddonRenewalScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AddonRenewalScheduler.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly paymentPort: PaymentPort,
    private readonly subscriptionEventsRepository: SubscriptionEventsRepository,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      this.renewDueAddons().catch((err: Error) => {
        this.logger.error(`renewDueAddons top-level error: ${err.message}`, err.stack);
      });
    }, CRON_INTERVAL_MS);

    this.logger.log(`AddonRenewalScheduler started (interval: ${CRON_INTERVAL_MS}ms)`);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log('AddonRenewalScheduler stopped');
    }
  }

  // ── Main entry point ──────────────────────────────────────────────────

  /**
   * Find all recurring add-on purchases due for renewal and process each one.
   *
   * Uses a processing_started_at lease to prevent concurrent processing:
   *   WHERE lifecycle = 'recurring'
   *     AND current_period_end <= now()
   *     AND status IN ('active', 'canceling', 'payment_failed')
   *     AND (processing_started_at IS NULL
   *          OR processing_started_at < now() - 5min)
   *
   * Requirements: 14.2, 14.3, 14.4
   */
  async renewDueAddons(now = new Date()): Promise<void> {
    const leaseExpiry = new Date(now.getTime() - LEASE_EXPIRY_MS);

    // Claim rows by setting processing_started_at atomically.
    // Only rows with no lease or an expired lease are eligible.
    const claimed = await this.db
      .update(addOnPurchases)
      .set({ processingStartedAt: now })
      .where(
        and(
          eq(addOnPurchases.lifecycle, 'recurring'),
          lte(addOnPurchases.currentPeriodEnd, now),
          or(
            isNull(addOnPurchases.processingStartedAt),
            lt(addOnPurchases.processingStartedAt, leaseExpiry),
          ),
          or(
            eq(addOnPurchases.status, 'active'),
            eq(addOnPurchases.status, 'canceling'),
            eq(addOnPurchases.status, 'payment_failed'),
          ),
        ),
      )
      .returning();

    if (claimed.length === 0) return;

    this.logger.log(`Processing ${claimed.length} due add-on purchase(s)`);

    for (const purchase of claimed as AddOnPurchase[]) {
      await this.processAddonPurchase(purchase, now);
    }
  }

  // ── Per-purchase dispatch ─────────────────────────────────────────────

  /**
   * Process a single add-on purchase in its own transaction.
   * Routes to the appropriate path based on status.
   */
  private async processAddonPurchase(purchase: AddOnPurchase, now: Date): Promise<void> {
    try {
      await this.db.transaction(async (tx: any) => {
        // Re-fetch inside the transaction to get the latest state
        // (another instance may have processed it between claim and here).
        const fresh = await tx.query.addOnPurchases.findFirst({
          where: eq(addOnPurchases.id, purchase.id),
        });

        if (!fresh) return; // Deleted between claim and processing

        // Guard: if another instance already cleared the lease and advanced
        // the period, skip (period end is now in the future).
        if (fresh.currentPeriodEnd && fresh.currentPeriodEnd > now) {
          await this.releaseLease(tx, purchase.id);
          return;
        }

        if (fresh.status === 'canceling') {
          await this.applyCancellation(tx, fresh, now);
        } else if (fresh.status === 'active') {
          await this.applyRenewal(tx, fresh, now);
        } else if (fresh.status === 'payment_failed') {
          await this.applyRetry(tx, fresh, now);
        } else {
          // Unexpected status — release lease and skip
          await this.releaseLease(tx, purchase.id);
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to process add-on purchase ${purchase.id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Release the lease so the next run can retry
      await this.db
        .update(addOnPurchases)
        .set({ processingStartedAt: null, updatedAt: new Date() })
        .where(eq(addOnPurchases.id, purchase.id))
        .catch((releaseErr: Error) => {
          this.logger.error(
            `Failed to release lease for add-on purchase ${purchase.id}: ${releaseErr.message}`,
          );
        });
    }
  }

  // ── Path: cancellation apply ──────────────────────────────────────────

  /**
   * Apply a pending cancellation at period end.
   *
   * The user already set status to 'canceling' via AddOnsService.cancel().
   * When the period ends, we finalize to 'canceled'.
   *
   * Requirements: 14.5
   */
  private async applyCancellation(tx: any, purchase: AddOnPurchase, now: Date): Promise<void> {
    const [updated] = await tx
      .update(addOnPurchases)
      .set({
        status: 'canceled',
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(addOnPurchases.id, purchase.id))
      .returning();

    // Audit event (Req 24.2)
    await this.subscriptionEventsRepository.append(tx, {
      userId: purchase.userId,
      eventType: 'addon_canceled',
      actorType: 'system',
      beforeSnapshot: purchase as unknown as Record<string, unknown>,
      afterSnapshot: updated as Record<string, unknown>,
      reason: `Add-on ${purchase.addonId} period ended with status canceling — finalized to canceled`,
    });

    this.logger.log(
      `Add-on purchase ${purchase.id} (user ${purchase.userId}, addon ${purchase.addonId}): cancellation finalized`,
    );
  }

  // ── Path: renewal ─────────────────────────────────────────────────────

  /**
   * Attempt renewal charge for an active recurring add-on.
   *
   * On success: advance period 30 days, reset consumption counters,
   *             emit addon_renewal_succeeded.
   * On failure: set status to 'payment_failed', emit addon_renewal_failed.
   *
   * Requirements: 14.2, 14.3
   */
  private async applyRenewal(tx: any, purchase: AddOnPurchase, now: Date): Promise<void> {
    const nextStart = purchase.currentPeriodEnd!;
    const nextEnd = addDays(nextStart, PERIOD_DAYS);

    const idempotencyKey = `addon_renewal:${purchase.id}:${nextStart.toISOString()}`;

    const charge = await this.paymentPort.charge({
      userId: purchase.userId,
      amountMinor: 0, // Amount resolved by PaymentPort adapter from catalog; 0 is a placeholder
      currency: purchase.locale === 'IN' ? 'INR' : 'USD',
      idempotencyKey,
      description: `Add-on renewal — ${purchase.addonId}`,
    });

    if (!charge.success) {
      await this.handleChargeFailure(tx, purchase, now, 'addon_renewal_failed');
      return;
    }

    // Record the payment
    await this.recordPayment(
      tx,
      purchase.userId,
      0, // placeholder — real amount from PaymentPort adapter
      purchase.locale === 'IN' ? 'INR' : 'USD',
      charge.providerRef,
      idempotencyKey,
    );

    const [updated] = await tx
      .update(addOnPurchases)
      .set({
        status: 'active',
        currentPeriodStart: nextStart,
        currentPeriodEnd: nextEnd,
        consumptionCounters: resetCounters(purchase.addonId),
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(addOnPurchases.id, purchase.id))
      .returning();

    // Audit event (Req 24.2)
    await this.subscriptionEventsRepository.append(tx, {
      userId: purchase.userId,
      eventType: 'addon_renewal_succeeded',
      actorType: 'system',
      beforeSnapshot: purchase as unknown as Record<string, unknown>,
      afterSnapshot: updated as Record<string, unknown>,
      reason: `Add-on ${purchase.addonId} renewed — new period ${nextStart.toISOString()} to ${nextEnd.toISOString()}`,
    });

    // Notification (Req 26.2 — renewal receipt)
    await this.notificationsService.scheduleInTx(tx, {
      type: 'email',
      payload: {
        userId: purchase.userId,
        templateId: 'receipt',
        addonId: purchase.addonId,
        periodStart: nextStart.toISOString(),
        periodEnd: nextEnd.toISOString(),
      },
      idempotencyKey: `addon_renewal_receipt:${purchase.id}:${nextStart.toISOString()}`,
    });

    this.logger.log(
      `Add-on purchase ${purchase.id} (user ${purchase.userId}, addon ${purchase.addonId}): renewal succeeded`,
    );
  }

  // ── Path: payment_failed retry ────────────────────────────────────────

  /**
   * Run a scheduled retry for an add-on in payment_failed status.
   *
   * Retry windows: +24h, +48h, +72h after the first failure.
   * After 3 failed retries: lapse → set status to 'lapsed', emit addon_lapsed.
   *
   * The "failed since" timestamp is derived from the purchase's
   * current_period_end (the moment the first failure was recorded).
   *
   * Requirements: 14.4
   */
  private async applyRetry(tx: any, purchase: AddOnPurchase, now: Date): Promise<void> {
    // Use current_period_end as the "failed since" anchor — it was set to
    // the original period end when the first failure occurred.
    const failedAt = purchase.currentPeriodEnd!;
    const attemptIndex = retryAttemptIndex(failedAt, now);

    if (attemptIndex < 0) {
      // No retry window reached yet — release lease and wait
      await this.releaseLease(tx, purchase.id);
      return;
    }

    const idempotencyKey = `addon_retry:${purchase.id}:attempt${attemptIndex + 1}:${failedAt.toISOString()}`;

    const charge = await this.paymentPort.charge({
      userId: purchase.userId,
      amountMinor: 0, // placeholder — real amount from PaymentPort adapter
      currency: purchase.locale === 'IN' ? 'INR' : 'USD',
      idempotencyKey,
      description: `Add-on renewal retry (attempt ${attemptIndex + 1}) — ${purchase.addonId}`,
    });

    if (charge.success) {
      // Retry succeeded — advance period and reset counters
      const nextStart = purchase.currentPeriodEnd!;
      const nextEnd = addDays(nextStart, PERIOD_DAYS);

      await this.recordPayment(
        tx,
        purchase.userId,
        0, // placeholder
        purchase.locale === 'IN' ? 'INR' : 'USD',
        charge.providerRef,
        idempotencyKey,
      );

      const [updated] = await tx
        .update(addOnPurchases)
        .set({
          status: 'active',
          currentPeriodStart: nextStart,
          currentPeriodEnd: nextEnd,
          consumptionCounters: resetCounters(purchase.addonId),
          processingStartedAt: null,
          updatedAt: now,
        })
        .where(eq(addOnPurchases.id, purchase.id))
        .returning();

      await this.subscriptionEventsRepository.append(tx, {
        userId: purchase.userId,
        eventType: 'addon_renewal_succeeded',
        actorType: 'system',
        beforeSnapshot: purchase as unknown as Record<string, unknown>,
        afterSnapshot: updated as Record<string, unknown>,
        reason: `Add-on ${purchase.addonId} renewal retry attempt ${attemptIndex + 1} succeeded`,
      });

      await this.notificationsService.scheduleInTx(tx, {
        type: 'email',
        payload: {
          userId: purchase.userId,
          templateId: 'receipt',
          addonId: purchase.addonId,
          periodStart: nextStart.toISOString(),
          periodEnd: nextEnd.toISOString(),
        },
        idempotencyKey: `addon_retry_receipt:${purchase.id}:${nextStart.toISOString()}`,
      });

      this.logger.log(
        `Add-on purchase ${purchase.id} (user ${purchase.userId}, addon ${purchase.addonId}): retry attempt ${attemptIndex + 1} succeeded`,
      );
      return;
    }

    // Retry failed
    if (attemptIndex >= MAX_RETRIES - 1) {
      // All retries exhausted — lapse the add-on (Req 14.4)
      await this.applyLapse(tx, purchase, now, attemptIndex + 1);
    } else {
      // More retries remain — stay in payment_failed, schedule next retry
      const nextRetryAt = addHours(failedAt, RETRY_HOURS[attemptIndex + 1]);

      await tx
        .update(addOnPurchases)
        .set({ processingStartedAt: null, updatedAt: now })
        .where(eq(addOnPurchases.id, purchase.id));

      await this.subscriptionEventsRepository.append(tx, {
        userId: purchase.userId,
        eventType: 'addon_renewal_failed',
        actorType: 'system',
        beforeSnapshot: purchase as unknown as Record<string, unknown>,
        reason: `Add-on ${purchase.addonId} renewal retry attempt ${attemptIndex + 1} failed — next retry at ${nextRetryAt.toISOString()}`,
      });

      await this.notificationsService.scheduleInTx(tx, {
        type: 'in_app',
        payload: {
          userId: purchase.userId,
          type: 'addon_payment_failed',
          addonId: purchase.addonId,
          attemptNumber: attemptIndex + 1,
          nextRetryAt: nextRetryAt.toISOString(),
        },
        idempotencyKey: `addon_payment_failed:${purchase.id}:attempt${attemptIndex + 1}`,
      });

      this.logger.warn(
        `Add-on purchase ${purchase.id} (user ${purchase.userId}, addon ${purchase.addonId}): retry attempt ${attemptIndex + 1} failed`,
      );
    }
  }

  // ── Path: lapse ───────────────────────────────────────────────────────

  /**
   * Lapse an add-on after all retries are exhausted.
   *
   * Atomically:
   *   - Set status to 'lapsed'
   *   - Emit addon_lapsed event
   *   - Notify user
   *
   * Requirements: 14.4
   */
  private async applyLapse(
    tx: any,
    purchase: AddOnPurchase,
    now: Date,
    attemptNumber: number,
  ): Promise<void> {
    const [updated] = await tx
      .update(addOnPurchases)
      .set({
        status: 'lapsed',
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(addOnPurchases.id, purchase.id))
      .returning();

    await this.subscriptionEventsRepository.append(tx, {
      userId: purchase.userId,
      eventType: 'addon_lapsed',
      actorType: 'system',
      beforeSnapshot: purchase as unknown as Record<string, unknown>,
      afterSnapshot: updated as Record<string, unknown>,
      reason: `All ${attemptNumber} payment retries exhausted — add-on ${purchase.addonId} lapsed`,
    });

    await this.notificationsService.scheduleInTx(tx, {
      type: 'email',
      payload: {
        userId: purchase.userId,
        templateId: 'addon_lapsed',
        addonId: purchase.addonId,
        attemptNumber,
      },
      idempotencyKey: `addon_lapsed_email:${purchase.id}:${now.toISOString()}`,
    });

    await this.notificationsService.scheduleInTx(tx, {
      type: 'in_app',
      payload: {
        userId: purchase.userId,
        type: 'addon_lapsed',
        addonId: purchase.addonId,
      },
      idempotencyKey: `addon_lapsed_inapp:${purchase.id}:${now.toISOString()}`,
    });

    this.logger.warn(
      `Add-on purchase ${purchase.id} (user ${purchase.userId}, addon ${purchase.addonId}): lapsed after ${attemptNumber} failed retries`,
    );
  }

  // ── Shared helpers ────────────────────────────────────────────────────

  /**
   * Handle a charge failure for an active add-on (first failure).
   * Sets status to 'payment_failed' and emits addon_renewal_failed event.
   * The current_period_end is NOT advanced — it serves as the "failed since"
   * anchor for retry window calculations.
   *
   * Requirements: 14.3, 14.4
   */
  private async handleChargeFailure(
    tx: any,
    purchase: AddOnPurchase,
    now: Date,
    reason: string,
  ): Promise<void> {
    const [updated] = await tx
      .update(addOnPurchases)
      .set({
        status: 'payment_failed',
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(addOnPurchases.id, purchase.id))
      .returning();

    await this.subscriptionEventsRepository.append(tx, {
      userId: purchase.userId,
      eventType: 'addon_renewal_failed',
      actorType: 'system',
      beforeSnapshot: purchase as unknown as Record<string, unknown>,
      afterSnapshot: updated as Record<string, unknown>,
      reason: `${reason} — status set to payment_failed, retries scheduled at +24h/+48h/+72h`,
    });

    await this.notificationsService.scheduleInTx(tx, {
      type: 'email',
      payload: {
        userId: purchase.userId,
        templateId: 'payment_failed',
        addonId: purchase.addonId,
        retryAt: addHours(purchase.currentPeriodEnd!, RETRY_HOURS[0]).toISOString(),
      },
      idempotencyKey: `addon_payment_failed_email:${purchase.id}:${purchase.currentPeriodEnd!.toISOString()}`,
    });

    await this.notificationsService.scheduleInTx(tx, {
      type: 'in_app',
      payload: {
        userId: purchase.userId,
        type: 'addon_payment_failed',
        addonId: purchase.addonId,
        attemptNumber: 0,
        nextRetryAt: addHours(purchase.currentPeriodEnd!, RETRY_HOURS[0]).toISOString(),
      },
      idempotencyKey: `addon_payment_failed_inapp:${purchase.id}:${purchase.currentPeriodEnd!.toISOString()}`,
    });

    this.logger.warn(
      `Add-on purchase ${purchase.id} (user ${purchase.userId}, addon ${purchase.addonId}): ${reason}`,
    );
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
    await tx
      .insert(payments)
      .values({
        userId,
        amountMinorUnits,
        currency,
        providerRef: providerRef ?? null,
        status: 'succeeded',
        idempotencyKey,
        chargedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  /**
   * Release the processing lease without making any other changes.
   * Used when a row is skipped (e.g. already processed by another instance).
   */
  private async releaseLease(tx: any, purchaseId: string): Promise<void> {
    await tx
      .update(addOnPurchases)
      .set({ processingStartedAt: null, updatedAt: new Date() })
      .where(eq(addOnPurchases.id, purchaseId));
  }
}
