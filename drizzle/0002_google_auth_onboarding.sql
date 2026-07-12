CREATE TYPE "public"."profile_completion_status" AS ENUM('incomplete', 'complete');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'verified');--> statement-breakpoint
ALTER TABLE "influencers" ADD COLUMN "google_user_id" text;--> statement-breakpoint
ALTER TABLE "influencers" ADD COLUMN "instagram_handle" text;--> statement-breakpoint
ALTER TABLE "influencers" ADD COLUMN "profile_completion_status" "profile_completion_status" DEFAULT 'incomplete' NOT NULL;--> statement-breakpoint
ALTER TABLE "influencers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "influencers" ADD COLUMN "email_verification_status" "verification_status" DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "influencers" ADD COLUMN "contact_number" text;--> statement-breakpoint
ALTER TABLE "influencers" ADD COLUMN "contact_verification_status" "verification_status" DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
UPDATE "influencers" SET "profile_completion_status" = 'complete' WHERE "instagram_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "influencers" ALTER COLUMN "instagram_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "influencers" DROP CONSTRAINT "influencers_instagram_user_id_unique";--> statement-breakpoint
CREATE INDEX "idx_influencers_google_user" ON "influencers" USING btree ("google_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_influencers_instagram_user_id" ON "influencers" USING btree ("instagram_user_id") WHERE "influencers"."instagram_user_id" IS NOT NULL;
