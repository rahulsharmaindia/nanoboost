CREATE TYPE "public"."user_role" AS ENUM('creator', 'brand', 'admin');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('Draft', 'Published', 'Active', 'Completed', 'Cancelled', 'Archived');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('Pending', 'Approved', 'Rejected', 'Withdrawn');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('Pending_Review', 'Approved', 'Revision_Requested', 'Published');--> statement-breakpoint
CREATE TYPE "public"."deletion_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"bio" text,
	"profile_picture_url" text,
	"follower_count" integer DEFAULT 0,
	"follows_count" integer DEFAULT 0,
	"media_count" integer DEFAULT 0,
	"niche" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "brand_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"logo" text,
	"industry" text NOT NULL,
	"website" text,
	"description" text,
	"social_links" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "brand_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "brand_profiles_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"campaign_id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"application_id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"influencer_id" text NOT NULL,
	"username" text DEFAULT 'unknown' NOT NULL,
	"follower_count" integer DEFAULT 0 NOT NULL,
	"status" "application_status" DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"submission_id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"influencer_id" text NOT NULL,
	"influencer_username" text,
	"content_url" text,
	"content_caption" text,
	"notes_to_brand" text,
	"revision_notes" text,
	"status" "submission_status" DEFAULT 'Pending_Review' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'instagram' NOT NULL,
	"provider_user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"username" text,
	"is_connected" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmation_code" text NOT NULL,
	"status" "deletion_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "account_deletion_requests_confirmation_code_unique" UNIQUE("confirmation_code")
);
--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_campaign_id_campaigns_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_campaign_id_campaigns_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;