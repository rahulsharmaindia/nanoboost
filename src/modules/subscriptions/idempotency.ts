/**
 * Idempotency key helpers for subscription payment operations.
 * Format: {action}:{subId}:{tier}:{periodStart}
 *
 * These keys prevent duplicate charges when the same operation is retried.
 * Requirements: design §Performance, Reliability, Security
 */

export function upgradeKey(subId: string, tier: string, periodStart: Date): string {
  return `upgrade:${subId}:${tier}:${periodStart.toISOString()}`;
}

export function renewalKey(subId: string, periodStart: Date): string {
  return `renewal:${subId}:${periodStart.toISOString()}`;
}

export function retryKey(subId: string, attemptNumber: number, failedAt: Date): string {
  return `retry:${subId}:attempt${attemptNumber}:${failedAt.toISOString()}`;
}

export function addonPurchaseKey(userId: string, addonId: string, timestamp: Date): string {
  return `addon_purchase:${userId}:${addonId}:${timestamp.toISOString()}`;
}

export function addonRenewalKey(purchaseId: string, periodStart: Date): string {
  return `addon_renewal:${purchaseId}:${periodStart.toISOString()}`;
}

export function downgradeRenewalKey(subId: string, tier: string, periodStart: Date): string {
  return `downgrade_renewal:${subId}:${tier}:${periodStart.toISOString()}`;
}
