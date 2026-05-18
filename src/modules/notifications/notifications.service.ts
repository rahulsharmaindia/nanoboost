// ── NotificationsService ──────────────────────────────────────────────────
//
// Schedules notifications via the transactional outbox pattern.
//
// Callers insert an outbox row inside the same DB transaction as their
// business event (e.g. subscription_events insert). A background dispatcher
// (OutboxDispatcherService) polls every 10 s, picks up pending rows, and
// delivers them via the active NotificationPort adapter.
//
// This guarantees at-least-once delivery: if the process crashes after the
// transaction commits but before the notification is sent, the dispatcher
// will retry on the next poll cycle.
//
// Requirements: 24.5, 26.7

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, lt, sql } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { outbox } from '../../database/schema/outbox.schema';
import { NotificationPort } from './ports/notification.port';

export interface ScheduleNotificationParams {
  /** 'email' or 'in_app' */
  type: 'email' | 'in_app';
  /** Notification payload — template id, variables, recipient, etc. */
  payload: Record<string, unknown>;
  /**
   * Idempotency key — unique per logical notification event.
   * Recommended format: '{event_type}:{entity_id}:{user_id}'.
   * Duplicate keys are silently ignored (ON CONFLICT DO NOTHING).
   */
  idempotencyKey: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** Maximum dispatch attempts before a row is marked 'failed'. */
  private static readonly MAX_ATTEMPTS = 5;

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly notificationPort: NotificationPort,
  ) {}

  // ── Scheduling ────────────────────────────────────────────────────────

  /**
   * Schedule a notification by inserting an outbox row within the caller's
   * existing transaction. The dispatcher will pick it up and send it.
   *
   * Must be called with a Drizzle transaction handle (`tx`) so the outbox
   * insert is atomic with the surrounding business event.
   *
   * Duplicate idempotency keys are silently ignored — safe to call multiple
   * times for the same logical event.
   */
  async scheduleInTx(
    tx: any,
    params: ScheduleNotificationParams,
  ): Promise<void> {
    await tx
      .insert(outbox)
      .values({
        type: params.type,
        payload: params.payload,
        idempotencyKey: params.idempotencyKey,
      })
      .onConflictDoNothing();
  }

  /**
   * Convenience method for scheduling a receipt email after a successful
   * charge. Fire-and-forget — inserts into the outbox asynchronously
   * outside of any caller transaction.
   *
   * Use `scheduleInTx` when you need the insert to be part of a transaction.
   */
  scheduleReceipt(userId: string, charge: { providerRef?: string }): void {
    const idempotencyKey = `receipt:${charge.providerRef ?? `${userId}:${Date.now()}`}`;

    this.db
      .insert(outbox)
      .values({
        type: 'email',
        payload: { templateId: 'receipt', userId, charge },
        idempotencyKey,
      })
      .onConflictDoNothing()
      .catch((err: Error) => {
        this.logger.error(
          `Failed to schedule receipt notification for user ${userId}: ${err.message}`,
        );
      });
  }

  // ── Dispatcher ────────────────────────────────────────────────────────

  /**
   * Idempotent dispatcher — called every 10 s by the scheduler.
   *
   * Picks up pending outbox rows, marks them as 'processing', dispatches
   * them via the active NotificationPort adapter, then marks them 'sent'.
   * On failure, increments the attempt counter; after MAX_ATTEMPTS marks
   * the row 'failed'.
   *
   * Uses an optimistic lock (status = 'pending') to prevent double-dispatch
   * when multiple instances run concurrently.
   */
  async dispatchPending(): Promise<void> {
    // Claim a batch of pending rows atomically.
    const claimed = await this.db
      .update(outbox)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(
        and(
          eq(outbox.status, 'pending'),
          lt(outbox.attempts, NotificationsService.MAX_ATTEMPTS),
        ),
      )
      .returning();

    for (const row of claimed) {
      await this.dispatchRow(row);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async dispatchRow(row: typeof outbox.$inferSelect): Promise<void> {
    try {
      const payload = row.payload as Record<string, unknown>;

      if (row.type === 'email') {
        await this.notificationPort.sendEmail({
          to: (payload.to as string) ?? '',
          templateId: (payload.templateId as string) ?? '',
          variables: payload,
        });
      } else if (row.type === 'in_app') {
        await this.notificationPort.sendInApp({
          userId: (payload.userId as string) ?? '',
          type: (payload.type as string) ?? '',
          payload,
        });
      } else {
        this.logger.warn(`Unknown outbox notification type: ${row.type}`);
      }

      // Mark as sent.
      await this.db
        .update(outbox)
        .set({
          status: 'sent',
          processedAt: new Date(),
          updatedAt: new Date(),
          attempts: sql`${outbox.attempts} + 1`,
        })
        .where(eq(outbox.id, row.id));
    } catch (err) {
      const newAttempts = row.attempts + 1;
      const nextStatus =
        newAttempts >= NotificationsService.MAX_ATTEMPTS ? 'failed' : 'pending';

      this.logger.error(
        `Outbox dispatch failed for row ${row.id} (attempt ${newAttempts}): ${(err as Error).message}`,
      );

      await this.db
        .update(outbox)
        .set({
          status: nextStatus,
          attempts: newAttempts,
          updatedAt: new Date(),
        })
        .where(eq(outbox.id, row.id));
    }
  }
}
