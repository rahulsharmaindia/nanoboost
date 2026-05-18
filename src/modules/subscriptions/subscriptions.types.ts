import type { Plan } from '../../database/schema/plans.schema';

// ── Branded primitive ─────────────────────────────────────────────────────
declare const __minorUnits: unique symbol;
export type MinorUnits = number & { readonly [__minorUnits]: true };
export const toMinorUnits = (n: number): MinorUnits => n as MinorUnits;

// ── Tier ──────────────────────────────────────────────────────────────────
export type Tier = 'creator' | 'growth' | 'studio';

const TIER_RANK: Record<Tier, number> = { creator: 0, growth: 1, studio: 2 };
const TIER_ORDER: Tier[] = ['creator', 'growth', 'studio'];

export function nextTier(tier: Tier): Tier {
  const rank = TIER_RANK[tier];
  return TIER_ORDER[Math.min(rank + 1, TIER_ORDER.length - 1)];
}

export function tierRank(tier: Tier): number {
  return TIER_RANK[tier];
}

// ── Feature ───────────────────────────────────────────────────────────────
export type Feature = 'application_outbound' | 'inbound_proposal' | 'ai_tool';

// ── Cap helpers ───────────────────────────────────────────────────────────
export function capForFeature(plan: Plan, feature: Feature): number {
  switch (feature) {
    case 'application_outbound': return plan.applicationCapMonthly;
    case 'inbound_proposal':     return plan.proposalCapMonthly;
    case 'ai_tool':              return plan.aiToolCapMonthly;
  }
}

// ── CheckResult ───────────────────────────────────────────────────────────
export type CheckResult =
  | { allowed: true; newValue: number; cap: number }
  | {
      allowed: false;
      reason: 'CAP_EXCEEDED' | 'TIER_LOCKED' | 'CONCURRENT_LIMIT_REACHED';
      current: number;
      cap: number;
      suggestedTier: Tier;
    };

// ── PaywallContext ────────────────────────────────────────────────────────
export type PaywallReason =
  | 'apply_to_campaigns'
  | 'ai_content_tool'
  | 'analytics_window'
  | 'concurrent_campaigns'
  | 'inbound_proposal_view';

export interface PaywallContext {
  reason: PaywallReason | string;
  highlightTier: Tier;
  returnTo?: string;
  screenMode: 'browse' | 'paywall' | 'onboarding';
}
