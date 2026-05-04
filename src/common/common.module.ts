// ── Common module ────────────────────────────────────────────
// Provides shared services (SessionService, guards) globally.
// Import this module once in AppModule — all other modules get
// access to SessionService and guards without re-importing.

import { Global, Module } from '@nestjs/common';
import { SessionService } from './services/session.service';
import { AuthGuard } from './guards/auth.guard';
import { BrandAuthGuard } from './guards/brand-auth.guard';

@Global()
@Module({
  providers: [SessionService, AuthGuard, BrandAuthGuard],
  exports: [SessionService, AuthGuard, BrandAuthGuard],
})
export class CommonModule {}
