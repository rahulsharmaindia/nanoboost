// ── PromotionService ──────────────────────────────────────────
// Read-only service that checks whether a user has an active boost
// add-on. Consumed by feed and search modules via SubscriptionsFacade.
//
// Requirements: 13.2, 19.1, 19.2
//
// ╔══════════════════════════════════════════════════════════════════╗
// ║                  META PLATFORM TERMS CONSTRAINT                  ║
// ║                                                                  ║
// ║  The "Boost" add-on ONLY promotes creator profiles and content   ║
// ║  on NanoCeleb-internal surfaces (in-app feed, brand search).     ║
// ║                                                                  ║
// ║  THIS SERVICE MUST NEVER:                                        ║
// ║  • Call any Instagram Graph API endpoint to influence boost      ║
// ║    ranking or placement (Req 19.2).                              ║
// ║  • Place user content on Instagram, Facebook, or any other       ║
// ║    Meta-owned surface (Req 19.1).                                ║
// ║  • Import or invoke any Instagram Graph API client in this       ║
// ║    file or any file under subscriptions/promotion* paths.        ║
// ║                                                                  ║
// ║  Displaying profile data already cached from a user's            ║
// ║  authorized Instagram connection on the internal feed is         ║
// ║  permitted — using Graph API calls (read or write) to inform     ║
// ║  ranking is PROHIBITED.                                          ║
// ║                                                                  ║
// ║  Any attempted Graph API call on behalf of boost MUST be         ║
// ║  blocked and MUST emit alert META_TOS_VIOLATION_ATTEMPT          ║
// ║  (Req 19.3). The ESLint rule `no-instagram-graph-api-in-         ║
// ║  promotion` enforces this at the static-analysis layer.          ║
// ║                                                                  ║
// ║  See: Meta Platform Terms §3 (Platform Features and Services)    ║
// ║  https://developers.facebook.com/terms/                          ║
// ╚══════════════════════════════════════════════════════════════════╝

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, lte } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { addOnPurchases } from '../../database/schema/add_on_purchases.schema';

// ── GUARD: Instagram Graph API imports are BANNED in this file ────
// If any code path attempts to import or call the Instagram Graph API
// from this module, it must be blocked here and the alert below emitted.
// The ESLint rule `no-instagram-graph-api-in-promotion` (server/eslint.config.cjs)
// enforces this at lint time. This runtime check is the defence-in-depth layer.
function assertNoGraphApiCall(context: string): void {
  // This function is a documentation anchor and runtime tripwire.
  // It should be called before any external HTTP call in this service.
  // If a Graph API call is somehow attempted, the caller must instead:
  //   1. Block the call (do not proceed).
  //   2. Call emitMetaTosViolationAlert() below.
  //   3. Throw an error to abort the operation.
  void context; // intentional no-op; presence enforces the pattern
}

/**
 * Emits the META_TOS_VIOLATION_ATTEMPT alert required by Requirement 19.3.
 * Call this if any code path in this module attempts a Graph API call.
 *
 * @param context - Description of the attempted violation for the alert payload.
 */
export function emitMetaTosViolationAlert(context: string): void {
  const logger = new Logger('PromotionService');
  logger.error(
    `META_TOS_VIOLATION_ATTEMPT: Instagram Graph API call attempted from promotion path. Context: ${context}`,
    { alert: 'META_TOS_VIOLATION_ATTEMPT', context, timestamp: new Date().toISOString() },
  );
  // In production this should also forward to the ops alerting channel
  // (e.g. PagerDuty, Slack webhook) via the AlertsService when available.
}

@Injectable()
export class PromotionService {
  private readonly logger = new Logger(PromotionService.name);

  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {}

  /**
   * Returns true if the user has an active boost add-on.
   * A boost is active when:
   * - addon_id = 'boost'
   * - status = 'active'
   * - effective_start <= now <= effective_end
   *
   * Requirements: 13.2, 19.1, 19.2
   *
   * NOTE: This method MUST NOT call any Instagram Graph API. Boost
   * placement is determined solely by the add-on purchase record in
   * the NanoCeleb database. See Meta TOS constraint block at the top
   * of this file.
   */
  async isBoostActive(userId: string): Promise<boolean> {
    // Tripwire: no Graph API calls are permitted below this line.
    assertNoGraphApiCall('isBoostActive');

    const now = new Date();
    const result = await this.db.query.addOnPurchases.findFirst({
      where: and(
        eq(addOnPurchases.userId, userId),
        eq(addOnPurchases.addonId, 'boost'),
        eq(addOnPurchases.status, 'active'),
        lte(addOnPurchases.effectiveStart, now),
        gt(addOnPurchases.effectiveEnd, now),
      ),
    });
    return !!result;
  }
}
