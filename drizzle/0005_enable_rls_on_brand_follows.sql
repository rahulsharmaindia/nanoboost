-- Migration: enable Row Level Security on brand_follows.
-- Matches the project-wide pattern where RLS is on but no policies
-- are defined — the server connects via the Postgres service role
-- (which bypasses RLS), and the Flutter client never talks to
-- Supabase directly. This keeps the table inaccessible via the
-- public anon / authenticated keys while leaving server-side
-- queries unchanged.

ALTER TABLE "brand_follows" ENABLE ROW LEVEL SECURITY;
