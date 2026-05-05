-- ══════════════════════════════════════════════════════════════
-- Performance Indexes & Row Level Security
-- Run after the initial schema migration.
-- ══════════════════════════════════════════════════════════════

-- ── Performance Indexes ──────────────────────────────────────

-- Campaigns: filter by brand, status, deadline, niche
CREATE INDEX IF NOT EXISTS "idx_campaigns_business_id" ON "campaigns" ("business_id");
CREATE INDEX IF NOT EXISTS "idx_campaigns_status" ON "campaigns" ("status");
CREATE INDEX IF NOT EXISTS "idx_campaigns_application_deadline" ON "campaigns" ("application_deadline");
CREATE INDEX IF NOT EXISTS "idx_campaigns_preferred_niche" ON "campaigns" ("preferred_niche");

-- Applications: lookup by campaign, influencer, status
CREATE INDEX IF NOT EXISTS "idx_applications_campaign_id" ON "applications" ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_applications_influencer_id" ON "applications" ("influencer_id");
CREATE INDEX IF NOT EXISTS "idx_applications_status" ON "applications" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_applications_campaign_influencer" ON "applications" ("campaign_id", "influencer_id");

-- Submissions: lookup by campaign, influencer
CREATE INDEX IF NOT EXISTS "idx_submissions_campaign_id" ON "submissions" ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_submissions_influencer_id" ON "submissions" ("influencer_id");
CREATE INDEX IF NOT EXISTS "idx_submissions_status" ON "submissions" ("status");

-- Social accounts: lookup by user, provider user ID
CREATE INDEX IF NOT EXISTS "idx_social_accounts_user_id" ON "social_accounts" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_social_accounts_provider_user_id" ON "social_accounts" ("provider_user_id");

-- Account deletion: lookup by user
CREATE INDEX IF NOT EXISTS "idx_account_deletion_user_id" ON "account_deletion_requests" ("user_id");

-- Creator profiles: search by username, niche
CREATE INDEX IF NOT EXISTS "idx_creator_profiles_username" ON "creator_profiles" ("username");
CREATE INDEX IF NOT EXISTS "idx_creator_profiles_niche" ON "creator_profiles" ("niche");

--> statement-breakpoint

-- ── Row Level Security ───────────────────────────────────────
-- The server uses service_role key (bypasses RLS).
-- These policies protect against direct client access.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "creator_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;

-- Users: can read own row
CREATE POLICY "users_select_own" ON "users"
  FOR SELECT USING (auth.uid()::text = id);

CREATE POLICY "users_update_own" ON "users"
  FOR UPDATE USING (auth.uid()::text = id);

-- Creator Profiles: owner can read/update/insert
CREATE POLICY "creator_profiles_select_own" ON "creator_profiles"
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "creator_profiles_update_own" ON "creator_profiles"
  FOR UPDATE USING (auth.uid()::text = user_id);

CREATE POLICY "creator_profiles_insert_own" ON "creator_profiles"
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- Brand Profiles: owner can read/update/insert
CREATE POLICY "brand_profiles_select_own" ON "brand_profiles"
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "brand_profiles_update_own" ON "brand_profiles"
  FOR UPDATE USING (auth.uid()::text = user_id);

CREATE POLICY "brand_profiles_insert_own" ON "brand_profiles"
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- Campaigns: brands manage own; creators can read published/active
CREATE POLICY "campaigns_select_published" ON "campaigns"
  FOR SELECT USING (
    status IN ('Published', 'Active')
    OR business_id IN (
      SELECT business_id FROM brand_profiles WHERE user_id = auth.uid()::text
    )
  );

CREATE POLICY "campaigns_insert_own" ON "campaigns"
  FOR INSERT WITH CHECK (
    business_id IN (
      SELECT business_id FROM brand_profiles WHERE user_id = auth.uid()::text
    )
  );

CREATE POLICY "campaigns_update_own" ON "campaigns"
  FOR UPDATE USING (
    business_id IN (
      SELECT business_id FROM brand_profiles WHERE user_id = auth.uid()::text
    )
  );

-- Applications: creators see own, brands see for their campaigns
CREATE POLICY "applications_select" ON "applications"
  FOR SELECT USING (
    influencer_id = auth.uid()::text
    OR campaign_id IN (
      SELECT campaign_id FROM campaigns
      WHERE business_id IN (
        SELECT business_id FROM brand_profiles WHERE user_id = auth.uid()::text
      )
    )
  );

CREATE POLICY "applications_insert_own" ON "applications"
  FOR INSERT WITH CHECK (influencer_id = auth.uid()::text);

-- Submissions: creators see own, brands see for their campaigns
CREATE POLICY "submissions_select" ON "submissions"
  FOR SELECT USING (
    influencer_id = auth.uid()::text
    OR campaign_id IN (
      SELECT campaign_id FROM campaigns
      WHERE business_id IN (
        SELECT business_id FROM brand_profiles WHERE user_id = auth.uid()::text
      )
    )
  );

CREATE POLICY "submissions_insert_own" ON "submissions"
  FOR INSERT WITH CHECK (influencer_id = auth.uid()::text);

-- Social Accounts: only owner can see (tokens are sensitive)
CREATE POLICY "social_accounts_select_own" ON "social_accounts"
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "social_accounts_insert_own" ON "social_accounts"
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "social_accounts_update_own" ON "social_accounts"
  FOR UPDATE USING (auth.uid()::text = user_id);

-- Account Deletion: only owner can see/create
CREATE POLICY "account_deletion_select_own" ON "account_deletion_requests"
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "account_deletion_insert_own" ON "account_deletion_requests"
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
