/**
 * Subscription error taxonomy.
 *
 * Each class carries a stable `code` string that is safe to send to clients
 * and to match in exception filters. Context fields are typed so callers
 * cannot accidentally omit required diagnostic data.
 *
 * Requirements: 3.2, 3.3, 3.4, 7.2, 1.11, 9.5, 25.3
 */

// ---------------------------------------------------------------------------
// Cap / tier enforcement errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a usage counter has reached the plan cap.
 * Maps to HTTP 402 / error code CAP_EXCEEDED.
 * Requirement 3.2
 */
export class CapExceededError extends Error {
  readonly code = 'CAP_EXCEEDED' as const;

  constructor(
    public readonly feature: string,
    public readonly currentTier: string,
    public readonly currentUsage: number,
    public readonly cap: number,
    public readonly suggestedTier: string,
  ) {
    super(`Cap exceeded for feature "${feature}" on tier "${currentTier}" (usage=${currentUsage}, cap=${cap})`);
    this.name = 'CapExceededError';
  }
}

/**
 * Thrown when a feature is entirely locked for the creator's current tier
 * (i.e. the cap is 0 and no counter should be created).
 * Maps to HTTP 402 / error code TIER_LOCKED.
 * Requirement 3.3
 */
export class TierLockedError extends Error {
  readonly code = 'TIER_LOCKED' as const;

  constructor(
    public readonly feature: string,
    public readonly currentTier: string,
    public readonly suggestedTier: string,
  ) {
    super(`Feature "${feature}" is locked for tier "${currentTier}" — upgrade to "${suggestedTier}"`);
    this.name = 'TierLockedError';
  }
}

/**
 * Thrown when a concurrent-state count (e.g. active campaigns) is at its cap.
 * Maps to HTTP 402 / error code CONCURRENT_LIMIT_REACHED.
 * Requirement 3.4
 */
export class ConcurrentLimitReachedError extends Error {
  readonly code = 'CONCURRENT_LIMIT_REACHED' as const;

  constructor(
    public readonly feature: string,
    public readonly currentCount: number,
    public readonly cap: number,
    public readonly suggestedTier: string,
  ) {
    super(`Concurrent limit reached for "${feature}" (count=${currentCount}, cap=${cap})`);
    this.name = 'ConcurrentLimitReachedError';
  }
}

// ---------------------------------------------------------------------------
// Tier transition errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a downgrade request targets a tier whose rank is not strictly
 * lower than the active tier, or equals the existing pending_tier.
 * Maps to HTTP 422 / error code INVALID_DOWNGRADE_TARGET.
 * Requirement 7.2
 */
export class InvalidDowngradeTargetError extends Error {
  readonly code = 'INVALID_DOWNGRADE_TARGET' as const;

  constructor(message?: string) {
    super(message ?? 'Invalid downgrade target: target tier rank must be strictly lower than the active tier');
    this.name = 'InvalidDowngradeTargetError';
  }
}

// ---------------------------------------------------------------------------
// Catalog errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the plans catalog cannot resolve any priced row for the user's
 * locale (both requested and fallback rows are missing for at least one tier).
 * Maps to HTTP 503 / error code CATALOG_UNAVAILABLE.
 * Requirement 1.11
 */
export class CatalogUnavailableError extends Error {
  readonly code = 'CATALOG_UNAVAILABLE' as const;

  constructor(message?: string) {
    super(message ?? 'Plans catalog unavailable — no priced rows found for the resolved locale');
    this.name = 'CatalogUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Payment errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the payment provider returns a failure for a charge attempt.
 * Maps to HTTP 402 / error code PAYMENT_FAILED.
 * Requirement 25.1
 */
export class PaymentFailedError extends Error {
  readonly code = 'PAYMENT_FAILED' as const;

  constructor(public readonly providerError?: string) {
    super(`Payment failed${providerError ? ': ' + providerError : ''}`);
    this.name = 'PaymentFailedError';
  }
}

/**
 * Thrown when a payout is attempted but the creator's subscription record
 * cannot be resolved (e.g. purged in error).
 * Maps to HTTP 500 + operations alert / error code MISSING_SUBSCRIPTION_FOR_PAYOUT.
 * Requirement 9.5
 */
export class MissingSubscriptionForPayoutError extends Error {
  readonly code = 'MISSING_SUBSCRIPTION_FOR_PAYOUT' as const;

  constructor(public readonly userId: string) {
    super(`Subscription record missing for payout — userId=${userId}`);
    this.name = 'MissingSubscriptionForPayoutError';
  }
}

/**
 * Thrown (or used as a guard) when a creator has an outstanding payment owed
 * (payment_owed=true) and attempts a new purchase.
 * Maps to HTTP 402 / error code PAYMENT_OWED.
 * Requirement 25.3
 */
export class PaymentOwedError extends Error {
  readonly code = 'PAYMENT_OWED' as const;

  constructor(public readonly userId?: string) {
    super(`Payment owed — purchases suspended${userId ? ' for userId=' + userId : ''}`);
    this.name = 'PaymentOwedError';
  }
}

// ---------------------------------------------------------------------------
// Subscription lookup errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a subscription record is expected but not found for a user.
 * Maps to HTTP 404 / error code SUBSCRIPTION_NOT_FOUND.
 */
export class SubscriptionNotFoundError extends Error {
  readonly code = 'SUBSCRIPTION_NOT_FOUND' as const;

  constructor(public readonly userId?: string) {
    super(`Subscription not found${userId ? ' for userId=' + userId : ''}`);
    this.name = 'SubscriptionNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Provisioning errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the initial subscription record cannot be created for a new user
 * (e.g. during signup). Used in task 6.1.
 * Maps to HTTP 500 / error code SUBSCRIPTION_PROVISIONING_FAILED.
 */
export class SubscriptionProvisioningError extends Error {
  readonly code = 'SUBSCRIPTION_PROVISIONING_FAILED' as const;

  constructor(message?: string) {
    super(message ?? 'Failed to provision subscription for new user');
    this.name = 'SubscriptionProvisioningError';
  }
}
