// ── Supabase SDK client ──────────────────────────────────────
// Use ONLY for Auth admin operations, Storage, and signed URLs.
// Normal database queries go through Drizzle (database.client.ts).

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

let _supabase: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return null;
  }
  if (!_supabase) {
    _supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabase;
}
