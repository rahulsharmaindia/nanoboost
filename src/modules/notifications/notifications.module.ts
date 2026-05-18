// ── Notifications module ──────────────────────────────────────────────────
//
// Provides NotificationsService (outbox-based scheduler), the active
// NotificationPort adapter (selected by NOTIFICATION_EMAIL_ADAPTER env var),
// and InAppNotificationAdapter (persists in-app rows to Postgres).
//
// Supported NOTIFICATION_EMAIL_ADAPTER values:
//   'console'  → ConsoleNotificationAdapter  (default — logs to stdout)
//   'ses'      → SesNotificationAdapter      (not yet implemented)
//   'postmark' → PostmarkNotificationAdapter (not yet implemented)
//
// Requirements: 24.5, 26.1–26.7, 5.1, 5.2, 23.2, 26.3

import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationPort } from './ports/notification.port';
import { ConsoleNotificationAdapter } from './adapters/console-notification.adapter';
import { InAppNotificationAdapter } from './in-app.adapter';
import { EmailAdapter } from './email.adapter';

/**
 * Resolve the concrete NotificationPort adapter from the
 * NOTIFICATION_EMAIL_ADAPTER env var.
 *
 * Future: add 'ses' and 'postmark' cases here when adapters are implemented.
 * Until then, any unrecognised value falls back to ConsoleNotificationAdapter
 * so the module always boots without crashing.
 */
function resolveNotificationAdapter() {
  const adapter = process.env.NOTIFICATION_EMAIL_ADAPTER;
  // Future: add 'ses' and 'postmark' cases here.
  if (adapter === 'console' || !adapter) {
    return ConsoleNotificationAdapter;
  }
  // Default to console for unrecognised values during development.
  return ConsoleNotificationAdapter;
}

@Module({
  providers: [
    NotificationsService,
    InAppNotificationAdapter,
    EmailAdapter,
    {
      provide: NotificationPort,
      useClass: resolveNotificationAdapter(),
    },
  ],
  exports: [NotificationsService, NotificationPort, InAppNotificationAdapter, EmailAdapter],
})
export class NotificationsModule {}
