// ── Database module ──────────────────────────────────────────
// Provides the Drizzle client and Supabase admin client as
// injectable tokens throughout the app.

import { Module, Global } from '@nestjs/common';
import { getDrizzleClient } from './database.client';
import { getSupabaseAdminClient } from './supabase.client';

export const DRIZZLE_CLIENT = 'DRIZZLE_CLIENT';
export const SUPABASE_ADMIN_CLIENT = 'SUPABASE_ADMIN_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_CLIENT,
      useFactory: () => getDrizzleClient(),
    },
    {
      provide: SUPABASE_ADMIN_CLIENT,
      useFactory: () => getSupabaseAdminClient(),
    },
  ],
  exports: [DRIZZLE_CLIENT, SUPABASE_ADMIN_CLIENT],
})
export class DatabaseModule {}
