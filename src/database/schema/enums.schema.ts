// ── Shared enums ─────────────────────────────────────────────
// All pgEnum definitions live here so every table file imports
// from one place and Drizzle emits each enum exactly once.

import { pgEnum } from 'drizzle-orm/pg-core';

// identity / auth
export const staffRoleEnum = pgEnum('staff_role', [
  'super_admin',
  'brand_manager',
  'influencer_manager',
  'finance',
  'support',
  'read_only',
]);
export const staffStatusEnum = pgEnum('staff_status', ['active', 'suspended']);
export const sessionStatusEnum = pgEnum('session_status', ['authenticated', 'error']);
export const partyTypeEnum = pgEnum('party_type', ['influencer', 'brand', 'staff']);
export const deletionStatusEnum = pgEnum('deletion_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

// market
export const campaignStatusEnum = pgEnum('campaign_status', [
  'Draft',
  'Published',
  'Active',
  'Completed',
  'Cancelled',
  'Archived',
]);
export const applicationStatusEnum = pgEnum('application_status', [
  'Pending',
  'Approved',
  'Rejected',
  'Withdrawn',
]);
export const submissionStatusEnum = pgEnum('submission_status', [
  'Pending_Review',
  'Approved',
  'Revision_Requested',
  'Published',
]);
export const collaborationStatusEnum = pgEnum('collaboration_status', [
  'pending',
  'active',
  'completed',
  'withdrawn',
  'rejected',
]);
export const proposalStatusEnum = pgEnum('proposal_status', [
  'delivered',
  'held_for_upgrade',
  'auto_declined',
  'declined',
  'withdrawn',
]);
export const genderTargetEnum = pgEnum('gender_target', ['Male', 'Female', 'All']);

// billing
export const tierEnum = pgEnum('tier', ['creator', 'growth', 'studio']);
export const localeEnum = pgEnum('locale', ['IN', 'US']);
export const currencyEnum = pgEnum('currency', ['INR', 'USD']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'canceling',
  'canceled',
  'payment_failed',
  'lapsed',
]);
export const addonIdEnum = pgEnum('addon_id', [
  'boost',
  'ai_growth_pack',
  'content_studio_pack',
]);
export const addonLifecycleEnum = pgEnum('addon_lifecycle', ['one_time', 'recurring']);
export const addonStatusEnum = pgEnum('addon_status', [
  'active',
  'canceling',
  'canceled',
  'expired',
  'payment_failed',
  'lapsed',
]);
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'reversed',
]);
export const paymentPurposeEnum = pgEnum('payment_purpose', [
  'subscription_renewal',
  'subscription_upgrade',
  'addon_purchase',
  'addon_renewal',
]);
export const payoutStatusEnum = pgEnum('payout_status', ['pending', 'processed', 'failed']);
export const subscriptionEventTypeEnum = pgEnum('subscription_event_type', [
  'subscription_created',
  'tier_upgraded',
  'tier_downgrade_requested',
  'tier_downgrade_applied',
  'cancellation_requested',
  'cancellation_applied',
  'cancellation_resumed',
  'renewal_succeeded',
  'renewal_failed',
  'payment_retry_succeeded',
  'subscription_lapsed',
  'addon_purchased',
  'addon_canceled',
  'addon_renewal_succeeded',
  'addon_renewal_failed',
  'addon_lapsed',
  'payment_reversed',
]);

// studio / platform
export const aiCreationKindEnum = pgEnum('ai_creation_kind', [
  'hook',
  'script',
  'caption',
  'idea',
]);
export const outboxStatusEnum = pgEnum('outbox_status', [
  'pending',
  'processing',
  'sent',
  'failed',
]);
