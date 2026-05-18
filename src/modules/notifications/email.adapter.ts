// ── EmailAdapter ──────────────────────────────────────────────────────────
//
// Thin dispatcher that routes email notifications to the active
// NotificationPort adapter (selected by NOTIFICATION_EMAIL_ADAPTER env var).
//
// This class is the single call-site for all outbound email in the
// notifications subsystem. It:
//   1. Logs every dispatch attempt (template id + recipient) for observability.
//   2. Delegates to the injected NotificationPort (ConsoleNotificationAdapter
//      by default; SesNotificationAdapter or PostmarkNotificationAdapter when
//      the env var is set to 'ses' or 'postmark').
//   3. Propagates any adapter error so the outbox dispatcher can retry.
//
// Supported NOTIFICATION_EMAIL_ADAPTER values:
//   'console'  → ConsoleNotificationAdapter  (default — logs to stdout)
//   'ses'      → SesNotificationAdapter      (not yet implemented)
//   'postmark' → PostmarkNotificationAdapter (not yet implemented)
//
// Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6

import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationPort,
  EmailMessage,
} from './ports/notification.port';

/**
 * EmailAdapter — thin dispatcher that routes email notifications to the
 * active NotificationPort adapter (selected by NOTIFICATION_EMAIL_ADAPTER).
 *
 * The actual adapter (ConsoleNotificationAdapter, SesNotificationAdapter,
 * etc.) is injected via NestJS DI in NotificationsModule.
 *
 * Supported email templates (templateId values):
 *   'receipt'               — Req 26.1: successful charge / upgrade
 *   'renewal_reminder'      — Req 26.2: 3 days before add-on renewal
 *   'payment_failed'        — Req 26.3: charge failure
 *   'downgrade_scheduled'   — Req 26.4: downgrade confirmation
 *   'cancellation_scheduled'— Req 26.5: cancellation confirmation
 *   'subscription_lapsed'   — Req 26.6: lapse / revert to creator tier
 */
@Injectable()
export class EmailAdapter {
  private readonly logger = new Logger(EmailAdapter.name);

  constructor(private readonly notificationPort: NotificationPort) {}

  /**
   * Dispatch an email via the active NotificationPort adapter.
   *
   * Logs the attempt before delegating so that every dispatch is traceable
   * even if the underlying adapter throws. The caller (outbox dispatcher)
   * is responsible for retry logic on failure.
   *
   * @param msg - The email message to send (recipient, template, variables).
   * @throws Re-throws any error from the underlying adapter so the outbox
   *         dispatcher can increment the attempt counter and retry.
   */
  async sendEmail(msg: EmailMessage): Promise<void> {
    this.logger.log(
      `Dispatching email template="${msg.templateId}" to="${msg.to}" adapter="${process.env.NOTIFICATION_EMAIL_ADAPTER ?? 'console'}"`,
    );
    await this.notificationPort.sendEmail(msg);
  }
}
