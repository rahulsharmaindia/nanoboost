-- Migration: convert brand_profiles.social_links to jsonb.
-- Existing values are stringified JSON, so the cast handles both
-- valid JSON ('{"instagram":"https://..."}') and NULLs without
-- losing data. Failures fall back to NULL so a malformed string
-- doesn't block the migration; callers will simply see no links
-- for that row and can re-save them.

ALTER TABLE "brand_profiles"
  ALTER COLUMN "social_links" TYPE jsonb
  USING (
    CASE
      WHEN social_links IS NULL OR social_links = '' THEN NULL
      ELSE
        CASE WHEN social_links ~ '^[[:space:]]*\{' THEN social_links::jsonb
             ELSE NULL
        END
    END
  );
