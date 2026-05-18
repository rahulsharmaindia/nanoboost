// ── Plans Catalog Service ─────────────────────────────────────
// Reads the plans table with locale-aware filtering, in-memory
// caching (5-min TTL), locale fallback, and structured error
// handling per Requirements 1.6, 1.7, 1.8, 1.10, 1.11, 18.1, 18.2.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { plans } from '../../database/schema/plans.schema';
import type { Plan } from '../../database/schema/plans.schema';
import { CatalogUnavailableError } from './subscriptions.errors';
import type { Tier } from './subscriptions.types';

// ── Types ─────────────────────────────────────────────────────────────────

export type Locale = 'IN' | 'US';

export interface CatalogResult {
  plans: Plan[];
  fallbackUsed: boolean;
}

export interface SinglePlanResult {
  plan: Plan;
  fallbackUsed: boolean;
}

// ── Cache entry ───────────────────────────────────────────────────────────

interface CacheEntry {
  plans: Plan[];
  expiresAt: number; // Date.now() ms
}

// ── Service ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REQUIRED_TIERS: Tier[] = ['creator', 'growth', 'studio'];

@Injectable()
export class PlansCatalogService {
  private readonly logger = new Logger(PlansCatalogService.name);

  /**
   * In-memory cache keyed by locale string.
   * Entries are invalidated after CACHE_TTL_MS.
   */
  private readonly cache = new Map<Locale, CacheEntry>();

  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {}

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Returns all three tier plans for the given locale.
   *
   * Cache hit: returns cached rows if still fresh.
   * Cache miss: queries the DB, applies locale fallback per Req 1.10,
   * throws CatalogUnavailableError per Req 1.11.
   *
   * Requirements: 1.6, 1.7, 1.8, 1.10, 1.11
   */
  async listPlans(locale: Locale): Promise<CatalogResult> {
    // 1. Check cache
    const cached = this.getFromCache(locale);
    if (cached) {
      return { plans: cached, fallbackUsed: false };
    }

    // 2. Query requested locale
    const rows = await this.queryByLocale(locale);

    if (this.hasAllTiers(rows)) {
      this.setCache(locale, rows);
      return { plans: rows, fallbackUsed: false };
    }

    // 3. Locale fallback per Req 1.10:
    //    IN user → fall back to IN; non-IN user → fall back to US.
    //    (If the requested locale already IS the fallback, skip re-query.)
    const fallbackLocale = this.fallbackLocaleFor(locale);
    let fallbackRows: Plan[] = rows;
    let fallbackUsed = false;

    if (fallbackLocale !== locale) {
      // Check fallback cache first
      const cachedFallback = this.getFromCache(fallbackLocale);
      fallbackRows = cachedFallback ?? await this.queryByLocale(fallbackLocale);
    }

    if (this.hasAllTiers(fallbackRows)) {
      // Log warning for each missing tier in the originally requested locale
      const missingTiers = this.missingTiers(rows);
      for (const tier of missingTiers) {
        this.logger.warn('MISSING_LOCALE_PRICE', {
          requestedLocale: locale,
          fallbackLocale,
          tier,
          timestamp: new Date().toISOString(),
        });
      }

      this.setCache(locale, fallbackRows);
      fallbackUsed = true;
      return { plans: fallbackRows, fallbackUsed };
    }

    // 4. Both requested and fallback rows are missing — Req 1.11
    throw new CatalogUnavailableError(
      `Plans catalog unavailable: no priced rows found for locale "${locale}" or fallback "${fallbackLocale}"`,
    );
  }

  /**
   * Returns a single plan for the given tier and locale.
   * Applies the same fallback logic as listPlans.
   *
   * Requirements: 1.6, 1.10, 1.11
   */
  async getPlan(tier: Tier, locale: Locale): Promise<SinglePlanResult> {
    const { plans: allPlans, fallbackUsed } = await this.listPlans(locale);
    const plan = allPlans.find((p) => p.tier === tier);

    if (!plan) {
      throw new CatalogUnavailableError(
        `Plans catalog unavailable: no row found for tier "${tier}" in locale "${locale}" or its fallback`,
      );
    }

    return { plan, fallbackUsed };
  }

  /**
   * Invalidates the entire in-memory cache.
   * Useful after a seed/migration that updates plan rows.
   */
  invalidateCache(): void {
    this.cache.clear();
    this.logger.log('Plans catalog cache invalidated');
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private getFromCache(locale: Locale): Plan[] | null {
    const entry = this.cache.get(locale);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(locale);
      return null;
    }
    return entry.plans;
  }

  private setCache(locale: Locale, rows: Plan[]): void {
    this.cache.set(locale, {
      plans: rows,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  private async queryByLocale(locale: Locale): Promise<Plan[]> {
    return this.db
      .select()
      .from(plans)
      .where(eq(plans.locale, locale)) as Promise<Plan[]>;
  }

  private hasAllTiers(rows: Plan[]): boolean {
    return REQUIRED_TIERS.every((tier) => rows.some((r) => r.tier === tier));
  }

  private missingTiers(rows: Plan[]): Tier[] {
    return REQUIRED_TIERS.filter((tier) => !rows.some((r) => r.tier === tier));
  }

  /**
   * Fallback locale per Req 1.10:
   * - IN user → IN (same, no cross-locale fallback for IN)
   * - non-IN user → US
   *
   * In practice the only two locales are 'IN' and 'US', so:
   * - locale 'IN' → fallback 'IN'  (no change; if IN rows are missing, catalog is unavailable)
   * - locale 'US' → fallback 'US'  (same; US is already the fallback for non-IN)
   *
   * The spec says "fall back to the IN row for an IN user and to the US row for any non-IN user".
   * Since the only supported locales are IN and US, the fallback is always the same locale.
   * This method is kept explicit for future extensibility (e.g. 'GB' → 'US').
   */
  private fallbackLocaleFor(locale: Locale): Locale {
    return locale === 'IN' ? 'IN' : 'US';
  }
}
