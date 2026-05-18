// ── InternalCapController ────────────────────────────────────
// Server-only endpoint for cap checks called by other backend
// modules (e.g. CampaignsService, AiToolsService) that prefer
// an HTTP round-trip over direct DI injection.
//
// Protected by ServerTokenGuard — callers must supply the
// INTERNAL_SERVER_TOKEN value in the `x-server-token` header.
//
// Requirements: 3.5, 3.7

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ServerTokenGuard } from '../auth/server-token.guard';
import { CapEnforcerService } from './cap-enforcer.service';
import { CapCheckDto } from './dto/cap-check.dto';
import { CheckResult } from './subscriptions.types';

@Controller('v1/internal')
@UseGuards(ServerTokenGuard)
export class InternalCapController {
  constructor(private readonly capEnforcerService: CapEnforcerService) {}

  /**
   * POST /v1/internal/cap-check
   *
   * Atomically checks and increments the usage counter for the
   * given user + feature combination. Returns a `CheckResult`
   * indicating whether the action is allowed or blocked.
   *
   * Body: `{ userId: string, feature: Feature }`
   *
   * Requirement 3.5: unlimited features always allowed.
   * Requirement 3.7: atomic increment — no double-spend under concurrency.
   */
  @Post('cap-check')
  async checkCap(@Body() dto: CapCheckDto): Promise<CheckResult> {
    return this.capEnforcerService.tryConsume(dto.userId, dto.feature);
  }
}
