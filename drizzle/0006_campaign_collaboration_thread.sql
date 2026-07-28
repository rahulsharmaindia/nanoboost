-- Collaboration thread: rename collaboration_status to PascalCase, add
-- collaboration_event_type enum, link submissions to collaborations, and
-- add the campaign_collaboration_events table.

-- ── collaboration_status → PascalCase ────────────────────────
-- The enum was unused (the table has no rows), so recreate it cleanly
-- with the new PascalCase label set.
ALTER TABLE "campaign_collaborations" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "campaign_collaborations" ALTER COLUMN "status" TYPE text;--> statement-breakpoint
DROP TYPE "collaboration_status";--> statement-breakpoint
CREATE TYPE "collaboration_status" AS ENUM ('Active', 'Completed', 'Withdrawn', 'Cancelled');--> statement-breakpoint
UPDATE "campaign_collaborations" SET "status" = 'Active';--> statement-breakpoint
ALTER TABLE "campaign_collaborations" ALTER COLUMN "status" TYPE "collaboration_status" USING "status"::"collaboration_status";--> statement-breakpoint
ALTER TABLE "campaign_collaborations" ALTER COLUMN "status" SET DEFAULT 'Active';--> statement-breakpoint

-- ── submission_status: add Rejected ──────────────────────────
ALTER TYPE "submission_status" ADD VALUE IF NOT EXISTS 'Rejected' BEFORE 'Published';--> statement-breakpoint

-- ── collaboration_event_type enum ────────────────────────────
CREATE TYPE "collaboration_event_type" AS ENUM (
  'message',
  'collaboration_started',
  'submission_created',
  'submission_resubmitted',
  'revision_requested',
  'submission_approved',
  'submission_rejected',
  'submission_published',
  'status_changed'
);--> statement-breakpoint

-- ── submissions ↔ collaborations link ────────────────────────
ALTER TABLE "campaign_submissions" ADD COLUMN "collaboration_id" text;--> statement-breakpoint
ALTER TABLE "campaign_submissions" ADD COLUMN "revision_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_submissions"
  ADD CONSTRAINT "campaign_submissions_collaboration_id_campaign_collaborations_id_fk"
  FOREIGN KEY ("collaboration_id") REFERENCES "public"."campaign_collaborations"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_submissions_collaboration" ON "campaign_submissions" ("collaboration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_collab_campaign" ON "campaign_collaborations" ("campaign_id");--> statement-breakpoint

-- ── collaboration events table ───────────────────────────────
CREATE TABLE IF NOT EXISTS "campaign_collaboration_events" (
  "id" text PRIMARY KEY NOT NULL,
  "collaboration_id" text NOT NULL,
  "type" "collaboration_event_type" NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "body" text,
  "submission_id" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "campaign_collaboration_events"
  ADD CONSTRAINT "campaign_collaboration_events_collaboration_id_campaign_collaborations_id_fk"
  FOREIGN KEY ("collaboration_id") REFERENCES "public"."campaign_collaborations"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_collaboration_events"
  ADD CONSTRAINT "campaign_collaboration_events_submission_id_campaign_submissions_submission_id_fk"
  FOREIGN KEY ("submission_id") REFERENCES "public"."campaign_submissions"("submission_id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_collab_events_collaboration" ON "campaign_collaboration_events" ("collaboration_id","created_at");

--> statement-breakpoint
-- Match the project convention: RLS enabled (server bypasses via direct connection).
ALTER TABLE "campaign_collaboration_events" ENABLE ROW LEVEL SECURITY;
