// ── Plans controller ─────────────────────────────────────────
// Public catalog endpoint. Read-only — no authentication required.
// Returns the locale-resolved list of tier plans for the Plans Screen
// and onboarding paywall.

import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PlansCatalogService } from './plans-catalog.service';
import type { Locale } from './plans-catalog.service';

@Controller('v1/plans')
export class PlansController {
  private readonly logger = new Logger(PlansController.name);

  constructor(private readonly plansCatalog: PlansCatalogService) {}

  /**
   * GET /v1/plans?locale=IN|US
   *
   * Returns the catalog as a flat array of plan rows for the requested
   * locale, with locale fallback and 5-min in-memory caching applied
   * by [PlansCatalogService.listPlans].
   *
   * Public endpoint — no session required so the Plans Screen can render
   * during onboarding (before the user has a session) and at the paywall
   * after a session has expired.
   *
   * Response shape (matches Flutter `Plan.fromJson`):
   * ```json
   * [
   *   { "id": "...", "tier": "creator", "locale": "IN", "priceMinorUnits": 0, ... },
   *   { "id": "...", "tier": "growth",  "locale": "IN", "priceMinorUnits": 49900, ... },
   *   { "id": "...", "tier": "studio",  "locale": "IN", "priceMinorUnits": 149900, ... }
   * ]
   * ```
   *
   * Errors:
   *   - 400 VALIDATION_ERROR — locale missing or not 'IN'/'US'.
   *   - 503 CATALOG_UNAVAILABLE — neither requested locale nor fallback
   *     has all three tiers (raised by PlansCatalogService).
   *
   * Requirements: 1.6, 1.7, 1.8, 1.10, 1.11, 15.1
   */
  @Get()
  @Public()
  async listPlans(@Query('locale') localeParam?: string): Promise<unknown[]> {
    const locale = this.parseLocale(localeParam);
    const { plans, fallbackUsed } = await this.plansCatalog.listPlans(locale);
    if (fallbackUsed) {
      this.logger.log(
        `Plans catalog served via locale fallback for "${locale}"`,
      );
    }
    return plans;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private parseLocale(raw: string | undefined): Locale {
    const value = (raw ?? '').toUpperCase();
    if (value === 'IN' || value === 'US') return value;
    throw new BadRequestException(
      `locale must be one of "IN", "US"; got "${raw ?? '(missing)'}".`,
    );
  }
}
