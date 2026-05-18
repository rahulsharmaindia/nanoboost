-- Add published_at column to campaigns table.
-- Tracks when a campaign transitions to 'Published' status.
-- Used by the studio early-access window (Req 2.8): campaigns published
-- within the last 24 hours are hidden from non-studio tiers.
ALTER TABLE "campaigns" ADD COLUMN "published_at" timestamp with time zone;
