CREATE TYPE "public"."currency" AS ENUM('INR', 'USD');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('IN', 'US');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('creator', 'growth', 'studio');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'canceling', 'canceled', 'payment_failed', 'lapsed');--> statement-breakpoint
CREATE TYPE "public"."addon_id" AS ENUM('boost', 'ai_growth_pack', 'content_studio_pack');--> statement-breakpoint
CREATE TYPE "public"."addon_lifecycle" AS ENUM('one_time', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."addon_status" AS ENUM('active', 'canceling', 'canceled', 'expired', 'payment_failed', 'lapsed');--> statement-breakpoint
CREATE TYPE "public"."subscription_event_type" AS ENUM('subscription_created', 'tier_upgraded', 'tier_downgrade_requested', 'tier_downgrade_applied', 'cancellation_requested', 'cancellation_applied', 'cancellation_resumed', 'renewal_succeeded', 'renewal_failed', 'payment_retry_succeeded', 'subscription_lapsed', 'addon_purchased', 'addon_canceled', 'addon_renewal_succeeded', 'addon_renewal_failed', 'addon_lapsed', 'payment_reversed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'reversed');--> statement-breakpoint
CREATE TABLE "plans" (
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tier" "tier" NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"pending_tier" "tier",
	"payment_owed" boolean DEFAULT false NOT NULL,
	"locale" "locale" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "period_valid" CHECK ("subscriptions"."current_period_end" > "subscriptions"."current_period_start")
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "add_on_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_period_valid" CHECK ("add_on_purchases"."lifecycle" <> 'recurring' OR "add_on_purchases"."current_period_end" IS NOT NULL),
	CONSTRAINT "one_time_effective_valid" CHECK ("add_on_purchases"."lifecycle" <> 'one_time' OR "add_on_purchases"."effective_end" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" text,
	"event_type" "subscription_event_type" NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_minor_units" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"provider_ref" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"charged_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_profiles" ALTER COLUMN "social_links" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "web_redirect_uri" text;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_tier_locale_uniq" ON "plans" USING btree ("tier","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_uniq" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "counter_user_feature_period_uniq" ON "usage_counters" USING btree ("user_id","feature","period_start");--> statement-breakpoint
CREATE INDEX "events_user_idx" ON "subscription_events" USING btree ("user_id","created_at");