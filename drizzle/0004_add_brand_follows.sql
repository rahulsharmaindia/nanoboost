-- Migration: add brand_follows table.
-- Stores the set of brands a creator (influencer) is following.
-- Supersedes the prior client-side SharedPreferences cache so the
-- follow set persists across devices and reinstalls.

CREATE TABLE IF NOT EXISTS "brand_follows" (
        "influencer_id" text NOT NULL,
        "brand_name" text NOT NULL,
        "business_id" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_follows_unique" ON "brand_follows" USING btree ("influencer_id","brand_name");
