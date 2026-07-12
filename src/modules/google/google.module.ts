import { Global, Module } from '@nestjs/common';
import { GoogleService } from './google.service';

// @Global so AuthService (and any future consumer) can inject
// GoogleService without importing GoogleModule explicitly, matching
// the shared-infrastructure pattern used by MetaModule.
@Global()
@Module({
  providers: [GoogleService],
  exports: [GoogleService],
})
export class GoogleModule {}
