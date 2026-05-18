import { Injectable } from '@nestjs/common';
import { subscriptionEvents } from '../../database/schema/subscription_events.schema';

export interface AppendEventParams {
  userId: string;
  subscriptionId?: string;
  eventType: typeof subscriptionEvents.$inferInsert['eventType'];
  actorType: 'user' | 'system' | 'admin';
  actorId?: string;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  reason?: string;
}

@Injectable()
export class SubscriptionEventsRepository {
  /**
   * Append an event within an existing transaction.
   * The tx parameter is a Drizzle transaction handle.
   * This is insert-only — no update or delete methods.
   */
  async append(tx: any, params: AppendEventParams): Promise<void> {
    await tx.insert(subscriptionEvents).values({
      userId: params.userId,
      subscriptionId: params.subscriptionId,
      eventType: params.eventType,
      actorType: params.actorType,
      actorId: params.actorId,
      beforeSnapshot: params.beforeSnapshot,
      afterSnapshot: params.afterSnapshot,
      reason: params.reason,
    });
  }
}
