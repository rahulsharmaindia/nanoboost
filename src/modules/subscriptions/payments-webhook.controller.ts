// ── Payments webhook controller ──────────────────────────────
// Receives raw webhook payloads from the active payment provider,
// delegates signature validation and event normalization entirely to
// PaymentPort.parseWebhook(), then dispatches the normalized WebhookEvent
// to the appropriate SubscriptionsService handler.
//
// Provider-specific logic (HMAC verification, payload shape, field mapping)
// lives exclusively inside the concrete PaymentPort adapter. This controller
// never inspects provider-specific fields.
//
// Requirements: 23.2, 25.1, 25.5

import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { PaymentPort } from './ports/payment.port';
import { SubscriptionsService } from './subscriptions.service';

@Controller('v1/payments')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly paymentPort: PaymentPort,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * POST /v1/payments/webhook
   *
   * Entry point for all payment provider webhook events. The raw request body
   * is forwarded to `PaymentPort.parseWebhook()` together with the provider
   * signature header so the adapter can verify authenticity before returning a
   * normalized `WebhookEvent`.
   *
   * Dispatch table:
   *   charge.succeeded  → no-op (idempotency handled by the charge path)
   *   charge.failed     → handleRenewalFailed (Req 23.2)
   *   charge.refunded   → handleReversal      (Req 25.1–25.4)
   *   chargeback        → handleReversal      (Req 25.1–25.4)
   *   mandate.canceled  → no-op in v1 (add-on mandate cancel deferred)
   *
   * Always returns HTTP 200 `{ received: true }` so the provider does not
   * retry on business-logic errors. Signature failures propagate as exceptions
   * and result in a 4xx/5xx, which is the correct signal to the provider.
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: any,
    @Headers('x-payment-signature') signature: string,
  ): Promise<{ received: boolean }> {
    // 1. Obtain the raw body buffer.
    //    NestJS / Express can be configured to expose req.rawBody via a
    //    bodyParser rawBody option. Fall back to re-serialising req.body so
    //    the controller works even without that configuration (signature
    //    verification will fail for providers that require the exact raw bytes,
    //    but the mock adapter accepts anything).
    const rawBody: Buffer =
      req.rawBody instanceof Buffer
        ? req.rawBody
        : Buffer.from(JSON.stringify(req.body ?? {}));

    // 2. Validate provider signature and parse into a normalized WebhookEvent.
    //    Throws if the signature is invalid — NestJS will return 400/500.
    const event = await this.paymentPort.parseWebhook(rawBody, signature ?? '');

    this.logger.log(
      `Webhook received: type=${event.type} providerRef=${event.providerRef} userId=${event.userId ?? 'unknown'}`,
    );

    // 3. Dispatch based on normalized event type.
    switch (event.type) {
      case 'charge.succeeded':
        // The charge path already marks the payment row as succeeded.
        // Webhook confirmation is a no-op here (idempotent).
        break;

      case 'charge.failed':
        // Req 23.2: set subscription status to payment_failed, retain tier,
        // retain counters, notify user, start grace-window retry schedule.
        if (event.userId) {
          await this.subscriptionsService.handleRenewalFailed(event.userId);
        } else {
          this.logger.warn(
            `charge.failed webhook missing userId — providerRef=${event.providerRef}`,
          );
        }
        break;

      case 'charge.refunded':
      case 'chargeback':
        // Req 25.1–25.4: look up charge timestamp, apply tier rollback (<7 days)
        // or payment_owed flag (≥7 days).
        if (event.userId && event.providerRef) {
          await this.subscriptionsService.handleReversal(
            event.userId,
            event.providerRef,
            event.reversedAt ?? new Date(),
          );
        } else {
          this.logger.warn(
            `${event.type} webhook missing userId or providerRef — providerRef=${event.providerRef}`,
          );
        }
        break;

      case 'mandate.canceled':
        // Mandate cancellation handling is deferred to a future task.
        // Log for observability; no state change in v1.
        this.logger.log(
          `mandate.canceled received — providerRef=${event.providerRef} userId=${event.userId ?? 'unknown'}`,
        );
        break;

      default: {
        // Exhaustive check: TypeScript will error if a new WebhookEvent type
        // is added to the union without a corresponding case here.
        const _exhaustive: never = event.type;
        this.logger.warn(`Unhandled webhook event type: ${_exhaustive}`);
      }
    }

    return { received: true };
  }
}
