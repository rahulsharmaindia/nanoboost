CREATE TYPE "public"."addon_id" AS ENUM('boost', 'ai_growth_pack', 'content_studio_pack');--> statement-breakpoint
CREATE TYPE "public"."addon_lifecycle" AS ENUM('one_time', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."addon_status" AS ENUM('active', 'canceling', 'canceled', 'expired', 'payment_failed', 'lapsed');--> statement-breakpoint
CREATE TYPE "public"."ai_creation_kind" AS ENUM('hook', 'script', 'caption', 'idea');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('Pending', 'Approved', 'Rejected', 'Withdrawn');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('Draft', 'Published', 'Active', 'Completed', 'Cancelled', 'Archived');--> statement-breakpoint
CREATE TYPE "public"."collaboration_status" AS ENUM('pending', 'active', 'completed', 'withdrawn', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('INR', 'USD');--> statement-breakpoint
CREATE TYPE "public"."deletion_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."gender_target" AS ENUM('Male', 'Female', 'All');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('IN', 'US');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('influencer', 'brand', 'staff');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('subscription_renewal', 'subscription_upgrade', 'addon_purchase', 'addon_renewal');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('delivered', 'held_for_upgrade', 'auto_declined', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('authenticated', 'error');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('super_admin', 'brand_manager', 'influencer_manager', 'finance', 'support', 'read_only');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('Pending_Review', 'Approved', 'Revision_Requested', 'Published');--> statement-breakpoint
CREATE TYPE "public"."subscription_event_type" AS ENUM('subscription_created', 'tier_upgraded', 'tier_downgrade_requested', 'tier_downgrade_applied', 'cancellation_requested', 'cancellation_applied', 'cancellation_resumed', 'renewal_succeeded', 'renewal_failed', 'payment_retry_succeeded', 'subscription_lapsed', 'addon_purchased', 'addon_canceled', 'addon_renewal_succeeded', 'addon_renewal_failed', 'addon_lapsed', 'payment_reversed');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'canceling', 'canceled', 'payment_failed', 'lapsed');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('creator', 'growth', 'studio');--> statement-breakpoint
CREATE TABLE "influencer_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"web_redirect_uri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "influencer_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"status" "session_status" DEFAULT 'authenticated' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "influencer_social_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"provider" text DEFAULT 'instagram' NOT NULL,
	"provider_user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"username" text,
	"is_connected" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "influencers" (
	"influencer_id" text PRIMARY KEY NOT NULL,
	"instagram_user_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"bio" text,
	"profile_picture_url" text,
	"follower_count" integer DEFAULT 0 NOT NULL,
	"follows_count" integer DEFAULT 0 NOT NULL,
	"media_count" integer DEFAULT 0 NOT NULL,
	"niche" text,
	"instagram_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "influencers_instagram_user_id_unique" UNIQUE("instagram_user_id")
);
--> statement-breakpoint
CREATE TABLE "brand_credentials" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"status" "session_status" DEFAULT 'authenticated' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"logo" text,
	"industry" text NOT NULL,
	"website" text,
	"description" text,
	"social_links" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"staff_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"status" "staff_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_role_permissions" (
	"role" "staff_role" NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	CONSTRAINT "staff_role_permissions_role_resource_action_pk" PRIMARY KEY("role","resource","action")
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"staff_id" text NOT NULL,
	"role" "staff_role" NOT NULL,
	CONSTRAINT "staff_roles_staff_id_role_pk" PRIMARY KEY("staff_id","role")
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"status" "session_status" DEFAULT 'authenticated' NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"campaign_id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"objective" text NOT NULL,
	"campaign_type" text NOT NULL,
	"platform" text DEFAULT 'Instagram',
	"post_types" text,
	"deliverables" text,
	"content_count_per_influencer" integer,
	"caption_guidelines" text,
	"hashtags" text,
	"mentions" text,
	"handle_to_tag" text,
	"reference_images" text,
	"age_group_min" integer NOT NULL,
	"age_group_max" integer NOT NULL,
	"gender" text NOT NULL,
	"target_location" text NOT NULL,
	"interests" text,
	"language_preference" text,
	"total_budget" numeric NOT NULL,
	"budget_per_creator" numeric NOT NULL,
	"payment_model" text NOT NULL,
	"commission_rate" numeric,
	"product_details" text,
	"bonus_criteria" text,
	"performance_incentive" text,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"application_deadline" text NOT NULL,
	"submission_deadline" text NOT NULL,
	"content_deadline" text NOT NULL,
	"revision_allowed_count" integer DEFAULT 0,
	"review_turnaround_hours" integer,
	"posting_time_window" text,
	"minimum_followers" integer NOT NULL,
	"required_engagement_rate" numeric NOT NULL,
	"preferred_niche" text NOT NULL,
	"content_style_expectations" text,
	"audience_gender_ratio" text,
	"total_slots" integer NOT NULL,
	"reserve_slots" integer,
	"priority_invite_list" text,
	"guidelines_dos" text,
	"guidelines_donts" text,
	"brand_messaging" text,
	"approval_process_description" text,
	"require_approval" text,
	"auto_approve_after_hours" integer,
	"status" "campaign_status" DEFAULT 'Draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_follows" (
	"influencer_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_follows_influencer_id_brand_id_pk" PRIMARY KEY("influencer_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "brand_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"influencer_id" text NOT NULL,
	"status" "proposal_status" DEFAULT 'delivered' NOT NULL,
	"budget_range" text,
	"deliverables" text,
	"message" text,
	"held_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_applications" (
	"application_id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"influencer_id" text NOT NULL,
	"username" text DEFAULT 'unknown' NOT NULL,
	"follower_count" integer DEFAULT 0 NOT NULL,
	"status" "application_status" DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_collaborations" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"influencer_id" text NOT NULL,
	"status" "collaboration_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_submissions" (
	"submission_id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"influencer_id" text NOT NULL,
	"influencer_username" text,
	"content_url" text,
	"content_caption" text,
	"notes_to_brand" text,
	"revision_notes" text,
	"status" "submission_status" DEFAULT 'Pending_Review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_campaigns" (
	"influencer_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_campaigns_influencer_id_campaign_id_pk" PRIMARY KEY("influencer_id","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "add_on_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"subscription_id" text,
	"addon_id" "addon_id" NOT NULL,
	"lifecycle" "addon_lifecycle" NOT NULL,
	"status" "addon_status" DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"effective_start" timestamp with time zone,
	"effective_end" timestamp with time zone,
	"remaining_credits" integer,
	"consumption_counters" jsonb,
	"locale" "locale" NOT NULL,
	"processing_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "influencer_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"deal_ref" text NOT NULL,
	"gross_amount_minor" integer NOT NULL,
	"commission_minor" integer NOT NULL,
	"creator_share_minor" integer NOT NULL,
	"commission_pct" integer NOT NULL,
	"tier_at_payout" "tier" NOT NULL,
	"currency" "currency" NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "influencer_payouts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"subscription_id" text,
	"add_on_purchase_id" text,
	"amount_minor_units" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"provider_ref" text,
	"idempotency_key" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"charged_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"subscription_id" text,
	"event_type" "subscription_event_type" NOT NULL,
	"actor_type" "party_type" NOT NULL,
	"actor_id" text,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"tier" "tier" NOT NULL,
	"locale" "locale" NOT NULL,
	"price_minor_units" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"is_most_popular" boolean DEFAULT false NOT NULL,
	"analytics_window_days" integer NOT NULL,
	"application_cap_monthly" integer NOT NULL,
	"proposal_cap_monthly" integer NOT NULL,
	"ai_tool_cap_monthly" integer NOT NULL,
	"commission_pct" integer NOT NULL,
	"concurrent_campaigns_cap" integer NOT NULL,
	"support_level" text NOT NULL,
	"early_access_hours" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"subscription_id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"tier" "tier" NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"pending_tier" "tier",
	"payment_owed" boolean DEFAULT false NOT NULL,
	"locale" "locale" NOT NULL,
	"processing_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_influencer_id_unique" UNIQUE("influencer_id")
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"feature" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_creations" (
	"id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"kind" "ai_creation_kind" NOT NULL,
	"title" text,
	"prompt" text,
	"content" text NOT NULL,
	"metadata" jsonb,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"metrics" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_app_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_type" "party_type" NOT NULL,
	"recipient_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" "party_type" NOT NULL,
	"subject_id" text NOT NULL,
	"confirmation_code" text NOT NULL,
	"status" "deletion_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "account_deletion_requests_confirmation_code_unique" UNIQUE("confirmation_code")
);
--> statement-breakpoint
ALTER TABLE "influencer_sessions" ADD CONSTRAINT "influencer_sessions_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "influencer_social_accounts" ADD CONSTRAINT "influencer_social_accounts_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_credentials" ADD CONSTRAINT "brand_credentials_brand_id_brands_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("brand_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sessions" ADD CONSTRAINT "brand_sessions_brand_id_brands_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("brand_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_staff_id_staff_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("staff_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_staff_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("staff_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_brands_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("brand_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_follows" ADD CONSTRAINT "brand_follows_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_follows" ADD CONSTRAINT "brand_follows_brand_id_brands_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("brand_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_proposals" ADD CONSTRAINT "brand_proposals_brand_id_brands_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("brand_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_proposals" ADD CONSTRAINT "brand_proposals_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_applications" ADD CONSTRAINT "campaign_applications_campaign_id_campaigns_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_applications" ADD CONSTRAINT "campaign_applications_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_collaborations" ADD CONSTRAINT "campaign_collaborations_campaign_id_campaigns_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_collaborations" ADD CONSTRAINT "campaign_collaborations_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_submissions" ADD CONSTRAINT "campaign_submissions_campaign_id_campaigns_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_submissions" ADD CONSTRAINT "campaign_submissions_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_campaigns" ADD CONSTRAINT "saved_campaigns_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_campaigns" ADD CONSTRAINT "saved_campaigns_campaign_id_campaigns_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_on_purchases" ADD CONSTRAINT "add_on_purchases_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_on_purchases" ADD CONSTRAINT "add_on_purchases_subscription_id_subscriptions_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("subscription_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "influencer_payouts" ADD CONSTRAINT "influencer_payouts_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("subscription_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_add_on_purchase_id_add_on_purchases_id_fk" FOREIGN KEY ("add_on_purchase_id") REFERENCES "public"."add_on_purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("subscription_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_creations" ADD CONSTRAINT "ai_creations_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inf_session_active" ON "influencer_sessions" USING btree ("influencer_id") WHERE "influencer_sessions"."status" = 'authenticated';--> statement-breakpoint
CREATE INDEX "idx_inf_session_expires" ON "influencer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_social_active" ON "influencer_social_accounts" USING btree ("influencer_id","provider") WHERE "influencer_social_accounts"."is_connected";--> statement-breakpoint
CREATE INDEX "idx_social_provider_user" ON "influencer_social_accounts" USING btree ("provider_user_id");--> statement-breakpoint
CREATE INDEX "idx_influencers_username" ON "influencers" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_influencers_niche" ON "influencers" USING btree ("niche");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_brand_session_active" ON "brand_sessions" USING btree ("brand_id") WHERE "brand_sessions"."status" = 'authenticated';--> statement-breakpoint
CREATE INDEX "idx_brand_session_expires" ON "brand_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_staff_session_expires" ON "staff_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_campaigns_brand" ON "campaigns" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "idx_campaigns_niche" ON "campaigns" USING btree ("preferred_niche");--> statement-breakpoint
CREATE INDEX "idx_campaigns_app_dl" ON "campaigns" USING btree ("application_deadline");--> statement-breakpoint
CREATE INDEX "idx_campaigns_browse" ON "campaigns" USING btree ("status") WHERE "campaigns"."status" in ('Published','Active');--> statement-breakpoint
CREATE INDEX "idx_follows_brand" ON "brand_follows" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "idx_proposals_influencer" ON "brand_proposals" USING btree ("influencer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_proposals_brand" ON "brand_proposals" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_applications_campaign" ON "campaign_applications" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_applications_influencer" ON "campaign_applications" USING btree ("influencer_id");--> statement-breakpoint
CREATE INDEX "idx_applications_status" ON "campaign_applications" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_application_campaign_influencer" ON "campaign_applications" USING btree ("campaign_id","influencer_id");--> statement-breakpoint
CREATE INDEX "idx_collab_influencer" ON "campaign_collaborations" USING btree ("influencer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_collab_campaign_influencer" ON "campaign_collaborations" USING btree ("campaign_id","influencer_id");--> statement-breakpoint
CREATE INDEX "idx_submissions_campaign" ON "campaign_submissions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_submissions_influencer" ON "campaign_submissions" USING btree ("influencer_id");--> statement-breakpoint
CREATE INDEX "idx_submissions_status" ON "campaign_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_saved_campaigns_campaign" ON "saved_campaigns" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_addon_influencer" ON "add_on_purchases" USING btree ("influencer_id","status");--> statement-breakpoint
CREATE INDEX "idx_payouts_influencer" ON "influencer_payouts" USING btree ("influencer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_payments_influencer" ON "payments" USING btree ("influencer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sub_events_influencer" ON "subscription_events" USING btree ("influencer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_plan_tier_locale" ON "subscription_plans" USING btree ("tier","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_counter_influencer_feature_period" ON "usage_counters" USING btree ("influencer_id","feature","period_start");--> statement-breakpoint
CREATE INDEX "idx_ai_creations" ON "ai_creations" USING btree ("influencer_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_snapshot_influencer_scope_time" ON "analytics_snapshots" USING btree ("influencer_id","scope","captured_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_influencer" ON "analytics_snapshots" USING btree ("influencer_id","captured_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_recipient" ON "in_app_notifications" USING btree ("recipient_type","recipient_id","is_read","created_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_pending" ON "outbox" USING btree ("status","created_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_deletion_subject" ON "account_deletion_requests" USING btree ("subject_type","subject_id");