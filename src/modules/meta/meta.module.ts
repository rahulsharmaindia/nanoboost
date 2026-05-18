import { Global, Module } from '@nestjs/common';
import { MetaService } from './meta.service';
import { MetaTokenService } from './meta-token.service';

// @Global so the auth guard (in CommonModule) can inject
// MetaTokenService without forcing every feature module to import
// MetaModule explicitly. MetaService + MetaTokenService are used
// as shared infrastructure across campaigns, social-accounts, etc.
@Global()
@Module({
  providers: [MetaService, MetaTokenService],
  exports: [MetaService, MetaTokenService],
})
export class MetaModule {}
