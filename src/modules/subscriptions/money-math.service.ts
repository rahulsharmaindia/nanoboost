/**
 * MoneyMathService — single source of truth for monetary arithmetic.
 *
 * Used by SubscriptionsService (proration on paid→paid upgrades) and
 * PayoutsService (commission + creator share on deal payouts).
 *
 * All rounding uses banker's rounding (round-half-to-even) to avoid
 * systematic bias across large volumes of transactions.
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 6.7, 9.2, 9.3
 */

import { Injectable } from '@nestjs/common';

@Injectable()
export class MoneyMathService {
  /**
   * Banker's rounding (round half to even) — never floor/ceil.
   *
   * Standard JavaScript `Math.round` uses "round half away from zero" which
   * introduces a systematic upward bias. Banker's rounding eliminates that
   * bias by rounding 0.5 to the nearest even integer.
   *
   * Examples:
   *   bankerRound(0.5)  → 0  (0 is even)
   *   bankerRound(1.5)  → 2  (2 is even)
   *   bankerRound(2.5)  → 2  (2 is even)
   *   bankerRound(3.5)  → 4  (4 is even)
   *   bankerRound(1.4)  → 1
   *   bankerRound(1.6)  → 2
   */
  bankerRound(x: number): number {
    const floor = Math.floor(x);
    const diff = x - floor;
    if (diff < 0.5) return floor;
    if (diff > 0.5) return floor + 1;
    // exactly 0.5 → round to even
    return floor % 2 === 0 ? floor : floor + 1;
  }

  /**
   * Pro-rate the upgrade delta over the days remaining in the period.
   *
   * Formula: bankerRound((p2 − p1) × (D − d) / D)
   *
   * Pre-conditions (all must hold):
   *   - p2 > p1          (upgrading to a more expensive plan)
   *   - d >= 0           (days elapsed is non-negative)
   *   - d < D            (still within the current period)
   *   - D > 0            (period length is positive; always 30 in practice)
   *
   * Returns a minor-currency-unit integer in [0, p2 − p1].
   *
   * Requirement 6.7, 22.5
   */
  proratedUpgrade(p1: number, p2: number, d: number, D: number): number {
    if (!(p2 > p1 && d >= 0 && d < D)) {
      throw new Error('proratedUpgrade preconditions violated');
    }
    return this.bankerRound((p2 - p1) * (D - d) / D);
  }

  /**
   * Commission for a payout.
   *
   * Formula: bankerRound(grossMinor × pct / 100)
   *
   * Pre-conditions:
   *   - grossMinor >= 0  (non-negative gross amount in minor units)
   *   - pct in [0, 100]  (valid percentage)
   *
   * Requirement 9.2, 22.2, 22.3
   */
  commission(grossMinor: number, pct: number): number {
    if (grossMinor < 0 || pct < 0 || pct > 100) {
      throw new Error('commission preconditions violated');
    }
    return this.bankerRound(grossMinor * pct / 100);
  }

  /**
   * Creator share — conservation by construction.
   *
   * Defined as subtraction (not independent computation) so that
   * commission + creatorShare === gross holds exactly for all inputs,
   * satisfying the PBT conservation property.
   *
   * Requirement 9.3, 22.4
   */
  creatorShare(grossMinor: number, commissionMinor: number): number {
    return grossMinor - commissionMinor;
  }
}
