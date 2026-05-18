-- Add processing_started_at lease column to subscriptions table.
-- Used by the period-advance scheduler to prevent concurrent processing
-- of the same subscription row across multiple scheduler instances.
-- A NULL value means the row is available for pickup.
-- A stale value (> 5 minutes old) is treated as an expired lease.
-- Requirements: 4.2, 23.1
ALTER TABLE "subscriptions" ADD COLUMN "processing_started_at" timestamp with time zone;
