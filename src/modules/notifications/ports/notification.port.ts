// ── NotificationPort — provider-agnostic notification interface ───────────
//
// All email and in-app notifications go through this abstract class.
// The concrete adapter is injected via NestJS DI and selected by the
// NOTIFICATION_EMAIL_ADAPTER environment variable:
//   'console'  → ConsoleNotificationAdapter  (default — logs to stdout)
//   'ses'      → SesNotificationAdapter      (not yet implemented)
//   'postmark' → PostmarkNotificationAdapter (not yet implemented)
//
// Swapping providers requires only a new adapter class — no changes to
// NotificationsService or any caller.
//
// Requirements: 26.1–26.7

export interface EmailMessage {
  /** Recipient email address. */
  to: string;
  /** Template identifier, e.g. 'receipt', 'renewal_reminder', 'payment_failed'. */
  templateId: string;
  /** Template variables merged into the template at render time. */
  variables: Record<string, unknown>;
}

export interface InAppMessage {
  userId: string;
  /** Notification type, e.g. 'proposal_held', 'payment_failed'. */
  type: string;
  /** Arbitrary payload surfaced to the Flutter client. */
  payload: Record<string, unknown>;
}

export abstract class NotificationPort {
  abstract sendEmail(msg: EmailMessage): Promise<void>;
  abstract sendInApp(msg: InAppMessage): Promise<void>;
}
