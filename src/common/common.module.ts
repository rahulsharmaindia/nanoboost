// ── Common module ────────────────────────────────────────────
// Provides shared services (session services, guards) globally.
// Import once in AppModule — all other modules get access without
// re-importing.

import { Global, Module } from '@nestjs/common';
import { InfluencerSessionService } from './services/influencer-session.service';
import { BrandSessionService } from './services/brand-session.service';
import { TokenCipher } from './services/token-cipher.service';
import { AuthGuard } from './guards/auth.guard';
import { BrandAuthGuard } from './guards/brand-auth.guard';

@Global()
@Module({
  providers: [
    TokenCipher,
    InfluencerSessionService,
    BrandSessionService,
    AuthGuard,
    BrandAuthGuard,
  ],
  exports: [
    TokenCipher,
    InfluencerSessionService,
    BrandSessionService,
    AuthGuard,
    BrandAuthGuard,
  ],
})
export class CommonModule {}
