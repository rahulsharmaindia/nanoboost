-- Migration: persist OAuth web redirect URI on the session row.
-- Replaces the in-memory Map in auth.controller that broke OAuth
-- across server restarts and multiple Railway replicas. With this
-- column the callback can rebuild the redirect URL no matter which
-- instance handles the request.

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "web_redirect_uri" text;
