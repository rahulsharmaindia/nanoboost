/**
 * PayoutsService — deal payout computation and persistence.
 *
 * Resolves the creator's active subscription tier at payout time, applies the
 * corresponding commission percentage via MoneyMathService, and persists the
 * payout record to the deal_payouts table.
 *
 * This service NEVER mutates subscription state — it only reads the tier via
 * SubscriptionsFacade and delegates all arithmetic to MoneyMathService.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { dealPayouts } from '../../database/schema/deal_payouts.schema';
import type { DealPayout } from '../../database/schema/deal_payouts.schema';
import { MoneyMathService } from '../subscriptions/money-math.service';
import { SubscriptionsFacade } from '../subscriptions/subscriptions.facade';
import { MissingSubscriptionForPayoutError } from '../subscriptions/subscriptions.errors';
import type { Tier } from '../subscriptions/subscriptions.types';

/** Commission percentage per tier. Mirrors Requirement 2.5. */
const COMMISSION_PCT_BY_TIER: Record<Tier, number> = {
  creator: 15,
  growth: 10,
  studio: 5,
};

export interface ComputePayoutInput {
  /** Creator user ID. */
  userId: string;
  /** Gross deal amount in minor currency units (paise / cents). */
  grossAmountMinor: number;
  /** Currency of the payout. */
  currency: 'INR' | 'USD';
  /** Opaque reference to the deal / campaign collaboration. */
  dealRef: string;
  /** Idempotency key — callers must supply a stable key per deal. */
  idempotencyKey: string;
}

export interface PayoutResult {
  id: string;
  userId: string;
  dealRef: string;
  grossAmountMinor: number;
  commissionMinor: number;
  creatorShareMinor: number;
  commissionPct: number;
  tierAtPayout: Tier;
  currency: 'INR' | 'USD';
  status: 'pending' | 'processed' | 'failed';
  createdAt: Date;
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly subscriptionsFacade: SubscriptionsFacade,
    private readonly moneyMathService: MoneyMathService,
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
  ) {}

  /**
   * Compute and persist a deal payout for a creator.
   *
   * Steps:
   *  1. Look up the creator's active subscription tier via SubscriptionsFacade.
   *  2. Derive the commission percentage from the tier (Req 2.5).
   *  3. Compute commission = bankerRound(gross × pct / 100) (Req 9.2).
   *  4. Compute creatorShare = gross − commission (Req 9.3).
   *  5. Persist the payout record and return it.
   *
   * Throws MissingSubscriptionForPayoutError (Req 9.5) when the subscription
   * record cannot be resolved, and emits an operations-level log alert.
   *
   * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
   */
  async computePayout(input: ComputePayoutInput): Promise<PayoutResult> {
    const { userId, grossAmountMinor, currency, dealRef, idempotencyKey } = input;

    // Req 9.1 — resolve tier at payout time
    const subscription = await this.subscriptionsFacade.getActive(userId);

    if (!subscription) {
      // Req 9.5 — reject with error and emit operations alert
      this.logger.error(
        `MISSING_SUBSCRIPTION_FOR_PAYOUT: userId=${userId} dealRef=${dealRef}`,
      );
      throw new MissingSubscriptionForPayoutError(userId);
    }

    const tier = subscription.tier as Tier;

    // Req 9.4 — use tier active at payout time (not at deal acceptance)
    const commissionPct = COMMISSION_PCT_BY_TIER[tier];

    // Req 9.2 — commission = bankerRound(gross × pct / 100)
    const commissionMinor = this.moneyMathService.commission(grossAmountMinor, commissionPct);

    // Req 9.3 — creatorShare := gross − commission (conservation by construction)
    const creatorShareMinor = this.moneyMathService.creatorShare(grossAmountMinor, commissionMinor);

    // Persist the payout record
    const [record] = await this.db
      .insert(dealPayouts)
      .values({
        userId,
        dealRef,
        grossAmountMinor,
        commissionMinor,
        creatorShareMinor,
        commissionPct,
        tierAtPayout: tier,
        currency,
        status: 'pending' as const,
        idempotencyKey,
      })
      .returning();

    this.logger.log(
      `Payout computed: id=${record.id} userId=${userId} tier=${tier} ` +
        `gross=${grossAmountMinor} commission=${commissionMinor} ` +
        `creatorShare=${creatorShareMinor} currency=${currency}`,
    );

    return {
      id: record.id,
      userId: record.userId,
      dealRef: record.dealRef,
      grossAmountMinor: record.grossAmountMinor,
      commissionMinor: record.commissionMinor,
      creatorShareMinor: record.creatorShareMinor,
      commissionPct: record.commissionPct,
      tierAtPayout: record.tierAtPayout as Tier,
      currency: record.currency as 'INR' | 'USD',
      status: record.status as 'pending' | 'processed' | 'failed',
      createdAt: record.createdAt,
    };
  }

  /**
   * Look up an existing payout record by its idempotency key.
   * Returns null if no record exists for the given key.
   *
   * Callers can use this to detect duplicate payout requests before calling
   * computePayout, enabling idempotent payout dispatch.
   */
  async findByIdempotencyKey(idempotencyKey: string): Promise<PayoutResult | null> {
    const record = await this.db.query.dealPayouts.findFirst({
      where: eq(dealPayouts.idempotencyKey, idempotencyKey),
    });

    if (!record) return null;

    return {
      id: record.id,
      userId: record.userId,
      dealRef: record.dealRef,
      grossAmountMinor: record.grossAmountMinor,
      commissionMinor: record.commissionMinor,
      creatorShareMinor: record.creatorShareMinor,
      commissionPct: record.commissionPct,
      tierAtPayout: record.tierAtPayout as Tier,
      currency: record.currency as 'INR' | 'USD',
      status: record.status as 'pending' | 'processed' | 'failed',
      createdAt: record.createdAt,
    };
  }
}
