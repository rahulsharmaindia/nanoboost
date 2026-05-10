-- ══════════════════════════════════════════════════════════════
-- Sessions + Brand Credentials
-- Replaces the in-memory session store with a DB-backed one and
-- persists brand password hashes separately from brand profiles.
-- ══════════════════════════════════════════════════════════════

CREATE TYPE "public"."session_status" AS ENUM('pending', 'authenticated', 'error');--> statement-breakpoint

CREATE TABLE "sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"access_token" text,
	"provider_user_id" text,
	"business_id" text,
	"status" "session_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint

CREATE TABLE "brand_credentials" (
	"business_id" text PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "brand_credentials" ADD CONSTRAINT "brand_credentials_business_id_brand_profiles_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."brand_profiles"("business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_sessions_business_id" ON "sessions" ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_provider_user_id" ON "sessions" ("provider_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_expires_at" ON "sessions" ("expires_at");--> statement-breakpoint

-- ── RLS ──────────────────────────────────────────────────────
-- Server uses service_role key (bypasses RLS). Disable for direct
-- client access to these tables (they must only be touched by the
-- server).

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_credentials" ENABLE ROW LEVEL SECURITY;
