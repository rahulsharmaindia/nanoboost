// ── BoostExpirationSweeper ────────────────────────────────────────────────
//
// Hourly cron that marks expired boost add-on purchases as 'expired'.
//
// A boost is a one-time, duration-based add-on. Its active window is
// defined by effective_start / effective_end. When effective_end <= now()
// and the row is still 'active', this sweeper transitions it to 'expired'.
//
// The UPDATE is a single bulk statement — no per-row transactions needed
// because the transition is idempotent and there is no money movement.
//
// Requirements: 13.3, 13.5

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, lte } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../database/database.module';
import { addOnPurchases } from '../../../database/schema/add_on_purchases.schema';

// ── Constants ─────────────────────────────────────────────────────────────

/** How often the sweeper runs (ms). One hour. */
const CRON_INTERVAL_MS = 60 * 60 * 1000;

// ── Sweeper ───────────────────────────────────────────────────────────────

@Injectable()
export class BoostExpirationSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BoostExpirationSweeper.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      this.expireBoosts().catch((err: Error) => {
        this.logger.error(`expireBoosts top-level error: ${err.message}`, err.stack);
      });
    }, CRON_INTERVAL_MS);

    this.logger.log(`BoostExpirationSweeper started (interval: ${CRON_INTERVAL_MS}ms)`);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log('BoostExpirationSweeper stopped');
    }
  }

  // ── Main sweep ────────────────────────────────────────────────────────

  /**
   * Bulk-expire all active boost purchases whose effective_end has passed.
   *
   * UPDATE add_on_purchases
   *    SET status = 'expired', updated_at = now
   *  WHERE addon_id = 'boost'
   *    AND status   = 'active'
   *    AND effective_end <= now
   *
   * The `now` parameter is injectable for deterministic unit testing.
   *
   * Requirement 13.3: boost benefit ends when the purchased duration expires.
   * Requirement 13.5: expired boosts are reflected immediately in isBoostActive.
   */
  async expireBoosts(now = new Date()): Promise<void> {
    const result = await this.db
      .update(addOnPurchases)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(addOnPurchases.addonId, 'boost'),
          eq(addOnPurchases.status, 'active'),
          lte(addOnPurchases.effectiveEnd, now),
        ),
      )
      .returning({ id: addOnPurchases.id });

    if (result.length > 0) {
      this.logger.log(`Expired ${result.length} boost purchase(s)`);
    }
  }
}
