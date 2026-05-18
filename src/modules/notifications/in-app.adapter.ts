// ── InAppNotificationAdapter ──────────────────────────────────────────────
//
// Persists in-app notification rows to the `in_app_notifications` table.
// The Flutter client reads these via the notifications endpoint.
//
// This adapter is called by the outbox dispatcher (NotificationsService)
// when it processes an 'in_app' outbox row. It implements the in-app half
// of the NotificationPort contract.
//
// Methods:
//   persist(userId, type, payload)  — write a new unread notification row
//   getUnread(userId)               — return up to 50 unread rows, newest first
//   markRead(userId, notificationId) — mark a single row as read (scoped to user)
//
// Requirements: 5.1, 5.2, 23.2, 26.3

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import {
  inAppNotifications,
  InAppNotification,
} from '../../database/schema/in_app_notifications.schema';

@Injectable()
export class InAppNotificationAdapter {
  private readonly logger = new Logger(InAppNotificationAdapter.name);

  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {}

  /**
   * Persist a new in-app notification row for the given user.
   * Called by the outbox dispatcher when it processes an 'in_app' row.
   */
  async persist(
    userId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert(inAppNotifications).values({ userId, type, payload });
    this.logger.debug(
      `Persisted in-app notification type="${type}" for user=${userId}`,
    );
  }

  /**
   * Return up to 50 unread notifications for the given user, newest first.
   * Used by the Flutter client via the notifications endpoint.
   */
  async getUnread(userId: string): Promise<InAppNotification[]> {
    return this.db
      .select()
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.userId, userId),
          eq(inAppNotifications.isRead, false),
        ),
      )
      .orderBy(desc(inAppNotifications.createdAt))
      .limit(50);
  }

  /**
   * Mark a single notification as read.
   * The userId scope prevents one user from marking another user's rows.
   */
  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.db
      .update(inAppNotifications)
      .set({ isRead: true })
      .where(
        and(
          eq(inAppNotifications.id, notificationId),
          eq(inAppNotifications.userId, userId),
        ),
      );
  }
}
