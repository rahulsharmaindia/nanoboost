-- ══════════════════════════════════════════════════════════════
-- Sessions: Meta long-lived token lifetime tracking
--
-- Adds columns to track the Instagram long-lived access token's
-- own expiry and the last refresh timestamp. Allows the auth
-- guard to proactively refresh tokens before they die (every 60
-- days) per Meta Graph API best practice, instead of forcing the
-- user back through OAuth on every session expiry.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_refreshed_at" timestamp;
--> statement-breakpoint

-- Backfill token_expires_at for existing authenticated sessions.
-- Assume tokens are at most 60 days from now; the guard will
-- refresh or reauth as needed when the user next hits the API.
UPDATE "sessions"
   SET "token_expires_at" = "created_at" + INTERVAL '60 days'
 WHERE "status" = 'authenticated'
   AND "access_token" IS NOT NULL
   AND "token_expires_at" IS NULL;
