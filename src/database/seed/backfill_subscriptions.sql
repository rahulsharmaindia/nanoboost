-- ── Creator subscription backfill (Req 17.5, 17.6) ─────────────────────────
-- Provisions a free `creator`-tier subscription row for every existing
-- creator user that does not already have one.
--
-- Idempotent: ON CONFLICT (user_id) DO NOTHING. Re-running this script is
-- always safe and inserts zero new rows once the population is consistent.
--
-- Locale notes:
--   The design.md sketch references a `users.country_code` column to derive
--   the locale (IN vs US). Our actual `users` schema has no such column, so
--   we default to 'IN' here, matching `SubscriptionsService.createForNewUser`
--   which also defaults locale to 'IN'. Locale is purely a pricing/currency
--   selector and can be migrated later as user metadata grows.
--
-- Usage:
--   psql "$DATABASE_URL" -f server/src/database/seed/backfill_subscriptions.sql
-- or programmatically via a tsx runner that issues this SQL through Drizzle.

-- Note on `id`: the Drizzle schema generates `id` via a JS `$defaultFn`
-- (randomUUID()), which does not fire on raw SQL inserts. We materialize a
-- UUID server-side via `gen_random_uuid()` (Postgres 13+ built-in, no
-- extension required) and cast to text since `id` is text-typed.

INSERT INTO subscriptions (
  id,
  user_id,
  tier,
  status,
  current_period_start,
  current_period_end,
  locale
)
SELECT
  gen_random_uuid()::text,
  u.id,
  'creator'::tier,
  'active'::subscription_status,
  now(),
  now() + interval '30 days',
  'IN'::locale
FROM users u
WHERE u.role = 'creator'
ON CONFLICT (user_id) DO NOTHING;
