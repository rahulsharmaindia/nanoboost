// ── Billing service ──────────────────────────────────────────
// Subscription plans catalog + one-subscription-per-influencer
// lifecycle (feature #9). Payment-provider integration is out of
// scope here — subscribe/cancel update state and append an audit
// event; a payment processor would later settle billing.payments.

import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import {
  subscriptionPlans,
  subscriptions,
  subscriptionEvents,
} from '../../database/schema/billing.schema';
import { ValidationError, NotFoundError } from '../../common/errors/app.errors';

type Tier = 'creator' | 'growth' | 'studio';
type Locale = 'IN' | 'US';
const TIERS: Tier[] = ['creator', 'growth', 'studio'];
const LOCALES: Locale[] = ['IN', 'US'];
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class BillingService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {
    if (!db) {
      throw new Error(
        'DATABASE_URL is not configured. BillingService requires a database connection.',
      );
    }
  }

  async listPlans(locale?: string) {
    const loc = (locale || 'IN').toUpperCase();
    const rows = LOCALES.includes(loc as Locale)
      ? await this.db
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.locale, loc as Locale))
      : await this.db.select().from(subscriptionPlans);
    return rows;
  }

  async getMySubscription(influencerId: string) {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.influencerId, influencerId));
    return rows[0] ?? null;
  }

  async subscribe(influencerId: string, tier: string, locale: string) {
    const t = (tier || '').toLowerCase();
    const loc = (locale || 'IN').toUpperCase();
    if (!TIERS.includes(t as Tier)) {
      throw new ValidationError(`tier must be one of: ${TIERS.join(', ')}`);
    }
    if (!LOCALES.includes(loc as Locale)) {
      throw new ValidationError(`locale must be one of: ${LOCALES.join(', ')}`);
    }

    // Ensure the plan exists for this tier+locale.
    const plan = await this.db
      .select()
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.tier, t as Tier),
          eq(subscriptionPlans.locale, loc as Locale),
        ),
      );
    if (plan.length === 0) {
      throw new NotFoundError('No plan available for that tier/locale');
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + PERIOD_MS);
    const existing = await this.getMySubscription(influencerId);

    let result: any;
    let eventType: string;
    if (!existing) {
      const [row] = await this.db
        .insert(subscriptions)
        .values({
          influencerId,
          tier: t as Tier,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          locale: loc as Locale,
        })
        .returning();
      result = row;
      eventType = 'subscription_created';
    } else {
      const [row] = await this.db
        .update(subscriptions)
        .set({
          tier: t as Tier,
          status: 'active',
          locale: loc as Locale,
          pendingTier: null,
          updatedAt: now,
        })
        .where(eq(subscriptions.influencerId, influencerId))
        .returning();
      result = row;
      eventType = 'tier_upgraded';
    }

    await this.recordEvent(influencerId, result.subscriptionId, eventType, {
      tier: t,
      locale: loc,
    });
    return result;
  }

  async cancel(influencerId: string) {
    const existing = await this.getMySubscription(influencerId);
    if (!existing) throw new NotFoundError('No active subscription');

    const [row] = await this.db
      .update(subscriptions)
      .set({ status: 'canceling', updatedAt: new Date() })
      .where(eq(subscriptions.influencerId, influencerId))
      .returning();

    await this.recordEvent(influencerId, existing.subscriptionId, 'cancellation_requested', {});
    return row;
  }

  private async recordEvent(
    influencerId: string,
    subscriptionId: string | null,
    eventType: string,
    after: Record<string, any>,
  ): Promise<void> {
    await this.db.insert(subscriptionEvents).values({
      influencerId,
      subscriptionId,
      eventType: eventType as any,
      actorType: 'influencer',
      actorId: influencerId,
      afterSnapshot: after,
    });
  }
}
