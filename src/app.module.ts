// ── Root application module ──────────────────────────────────
// Imports all feature modules. Keep this file thin.

import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';

// Infrastructure
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';

// Guards, filters, interceptors
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AuthGuard } from './common/guards/auth.guard';

// Feature modules
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { MetaModule } from './modules/meta/meta.module';
import { SocialAccountsModule } from './modules/social-accounts/social-accounts.module';
import { BrandsModule } from './modules/brands/brands.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    // CommonModule is @Global — SessionService and guards available everywhere
    CommonModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    MetaModule,
    SocialAccountsModule,
    BrandsModule,
    CampaignsModule,
    AiModule,
  ],
  providers: [
    // Global exception filter — consistent error response shape
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },

    // Global request ID — every response gets { data, error, requestId }
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },

    // Global request logger
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
