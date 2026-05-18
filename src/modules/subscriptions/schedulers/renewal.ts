// ── Renewal failure, retry, and lapse constants ──────────────────────────────
//
// This file documents and re-exports the retry/lapse constants used by the
// PeriodAdvanceScheduler. The full implementation lives in:
//   server/src/modules/subscriptions/schedulers/period-advance.scheduler.ts
//
// Lifecycle on first charge failure (Req 23.2, 23.3):
//   status → 'payment_failed'
//   Retry 1: +24h from initial failure
//   Retry 2: +48h from initial failure
//   Retry 3: +72h from initial failure
//
// On third retry failure — lapse (Req 23.4, 23.5, 23.6, 23.7, 23.8):
//   status → 'lapsed'
//   tier   → 'creator'
//   usage_counters deleted (reset to 0)
//   subscription_lapsed event appended
//   email + in-app notification sent
//   held proposals released per Req 5.8 (wired when ProposalsModule is ready — task 12.8)
//
// Requirements: 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8

// ── Retry schedule ────────────────────────────────────────────────────────────

/** Hours after the first failure at which each retry attempt is scheduled. */
export const RENEWAL_RETRY_HOURS = [24, 48, 72] as const;

/** Total number of retry attempts before the subscription lapses. */
export const RENEWAL_MAX_RETRIES = 3;

// ── Held-proposal release on lapse (Req 23.8) ────────────────────────────────
//
// Requirement 23.5 states that on lapse the system SHALL "release held proposals
// per Requirement 5.8". Requirement 5.8 states that at period end, up to 3 oldest
// held_for_upgrade proposals are released to delivered status under the new period's
// reset counter.
//
// The inbound-proposal queue (held_for_upgrade status) is owned by ProposalsModule
// and is implemented in task 12.8. Once that module exists, the `applyLapse` method
// in PeriodAdvanceScheduler should call a facade method such as:
//
//   await proposalsFacade.releaseHeldProposalsOnLapse(tx, sub.userId);
//
// That method should:
//   1. Query proposals WHERE creator_user_id = userId AND status = 'held_for_upgrade'
//      ORDER BY received_at ASC LIMIT 3
//   2. UPDATE those rows SET status = 'delivered'
//   3. Notify the user for each released proposal
//
// Until task 12.8 is complete, the lapse path in PeriodAdvanceScheduler logs a
// warning so the gap is visible in production logs:
//
//   this.logger.warn(
//     `Subscription ${sub.id}: lapsed — held-proposal release skipped (ProposalsModule not yet wired)`,
//   );
//
// ── Integration checklist for task 12.8 ──────────────────────────────────────
//
// When implementing task 12.8 (proposals dispatch + held queue):
//   1. Add `held_for_upgrade` to the proposal status enum in proposals.schema.ts
//   2. Implement `ProposalsFacade.releaseHeldProposalsOnLapse(tx, userId)` in
//      server/src/modules/proposals/proposals.facade.ts
//   3. Import ProposalsFacade into PeriodAdvanceScheduler via constructor injection
//   4. Replace the logger.warn stub in applyLapse() with the actual facade call
//   5. Remove this comment block once wired
