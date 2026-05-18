// ── ConsoleNotificationAdapter ────────────────────────────────────────────
//
// Development / test adapter that logs notifications to stdout instead of
// dispatching them to a real provider. Selected when
// NOTIFICATION_EMAIL_ADAPTER=console (or when the env var is unset).
//
// Requirements: 26.1–26.7

import { Injectable } from '@nestjs/common';
import {
  NotificationPort,
  EmailMessage,
  InAppMessage,
} from '../ports/notification.port';

@Injectable()
export class ConsoleNotificationAdapter extends NotificationPort {
  async sendEmail(msg: EmailMessage): Promise<void> {
    console.log('[ConsoleNotificationAdapter] sendEmail', JSON.stringify(msg));
  }

  async sendInApp(msg: InAppMessage): Promise<void> {
    console.log('[ConsoleNotificationAdapter] sendInApp', JSON.stringify(msg));
  }
}
