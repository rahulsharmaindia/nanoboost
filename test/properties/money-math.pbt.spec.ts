import * as fc from 'fast-check';
import { MoneyMathService } from '../../src/modules/subscriptions/money-math.service';

/**
 * Property-based tests for MoneyMathService.
 *
 * Commission percentages by tier (from plans seed / Requirement 2.5):
 *   creator = 15%
 *   growth  = 10%
 *   studio  =  5%
 */

const TIER_PCTS = {
  creator: 15,
  growth: 10,
  studio: 5,
} as const;

type Tier = keyof typeof TIER_PCTS;

describe('MoneyMathService — property-based tests', () => {
  let svc: MoneyMathService;

  beforeEach(() => {
    svc = new MoneyMathService();
  });

  /**
   * Property 1: Money conservation
   * Validates: Requirements 22.1, 22.4, 9.6
   *
   * For all G ∈ [0, 1e7] and tier T:
   *   commission(G, T) + creatorShare(G, commission(G, T)) === G
   */
  it('Property 1 — money conservation: commission + creatorShare === gross for all G and tiers', () => {
    const grossArb = fc.integer({ min: 0, max: 10_000_000 });
    const tierArb = fc.constantFrom<Tier>('creator', 'growth', 'studio');

    fc.assert(
      fc.property(grossArb, tierArb, (gross, tier) => {
        const pct = TIER_PCTS[tier];
        const comm = svc.commission(gross, pct);
        const share = svc.creatorShare(gross, comm);
        return comm + share === gross;
      }),
      { numRuns: 10_000 },
    );
  });

  /**
   * Property 2: Proration bounds
   * Validates: Requirements 22.5, 6.7
   *
   * For all 0 ≤ p1 < p2, 0 ≤ d < 30:
   *   0 ≤ proratedUpgrade(p1, p2, d, 30) ≤ p2 − p1
   */
  it('Property 2 — proration bounds: result is in [0, p2 − p1] for all valid inputs', () => {
    // p1 in [0, 1e7), p2 in (p1, 1e7], d in [0, 29]
    const arb = fc
      .tuple(
        fc.integer({ min: 0, max: 9_999_999 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 29 }),
      )
      .filter(([p1, p2]) => p2 > p1);

    fc.assert(
      fc.property(arb, ([p1, p2, d]) => {
        const result = svc.proratedUpgrade(p1, p2, d, 30);
        return result >= 0 && result <= p2 - p1;
      }),
      { numRuns: 10_000 },
    );
  });

  /**
   * Property 3: Commission ordering by tier
   * Validates: Requirements 9.7, 9.8, 2.5
   *
   * For all G > 0:
   *   commission(G, 15) ≥ commission(G, 10) ≥ commission(G, 5)
   *   (creator ≥ growth ≥ studio)
   */
  it('Property 3 — commission ordering: creator ≥ growth ≥ studio for all G > 0', () => {
    const grossArb = fc.integer({ min: 1, max: 10_000_000 });

    fc.assert(
      fc.property(grossArb, (gross) => {
        const commCreator = svc.commission(gross, TIER_PCTS.creator); // 15%
        const commGrowth = svc.commission(gross, TIER_PCTS.growth);   // 10%
        const commStudio = svc.commission(gross, TIER_PCTS.studio);   // 5%
        return commCreator >= commGrowth && commGrowth >= commStudio;
      }),
      { numRuns: 10_000 },
    );
  });
});
