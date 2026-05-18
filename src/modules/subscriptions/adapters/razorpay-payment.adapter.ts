// ── RazorpayPaymentAdapter ────────────────────────────────────────────────
//
// Selected when PAYMENT_ADAPTER=razorpay.
//
// Responsibilities:
//   - Create Razorpay Orders (the "intent" object that Razorpay Checkout
//     consumes). The actual payment is collected client-side via Razorpay's
//     hosted Checkout JS, then verified server-side by signature comparison.
//   - Verify the order/payment/signature triple returned by Checkout
//     (HMAC SHA256 of `orderId|paymentId` keyed by RAZORPAY_KEY_SECRET).
//   - Validate webhook signatures (HMAC SHA256 of the raw body keyed by
//     RAZORPAY_WEBHOOK_SECRET) and normalize them into the WebhookEvent
//     shape used by the rest of the app.
//
// What this adapter does NOT do:
//   - Auto-charge the user from the server (no `charge()` flow). Razorpay
//     in our setup requires user interaction for each payment. The flow is:
//        1. server creates an Order (this adapter, called by the controller)
//        2. client opens Razorpay Checkout with that orderId
//        3. user pays
//        4. server verifies and finalizes (also via this adapter)
//   - createMandate / cancelMandate. Auto-renewals via Razorpay Subscriptions
//     API are deferred to a later phase. For now we throw so the period-advance
//     scheduler will report the renewal as failed; real production usage needs
//     the subscriptions flow to be wired before launch.
//
// Test keys (rzp_test_...) and live keys (rzp_live_...) use the same code
// path. Razorpay routes to its sandbox or live environment based on the
// key prefix; nothing in this adapter changes between modes.

import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import Razorpay from 'razorpay';
import { env } from '../../../config/env';
import {
  ChargeRequest,
  ChargeResult,
  MandateRequest,
  PaymentPort,
  WebhookEvent,
} from '../ports/payment.port';

/** Razorpay Order returned by `orders.create()`. */
export interface RazorpayOrder {
  id: string;          // e.g. "order_NXa83hG..."
  amount: number;      // minor units, echoed back
  currency: string;    // e.g. "INR"
  receipt?: string;    // our idempotency key (≤40 chars)
  status: string;      // "created" | "attempted" | "paid"
}

/** Result of a successful order creation. Returned to the client so it can
 *  open Razorpay Checkout. */
export interface OrderCreationResult {
  orderId: string;
  amountMinor: number;
  currency: 'INR' | 'USD';
  /** Public key id, safe to expose to the client. */
  keyId: string;
  /** Our internal idempotency key (mirrored back as Razorpay's `receipt`). */
  idempotencyKey: string;
}

/** Payload returned by Razorpay Checkout's `handler` callback. */
export interface VerifyPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

@Injectable()
export class RazorpayPaymentAdapter extends PaymentPort {
  private readonly logger = new Logger(RazorpayPaymentAdapter.name);
  private readonly client: Razorpay;
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor() {
    super();
    this.keyId = env.razorpayKeyId;
    this.keySecret = env.razorpayKeySecret;
    this.webhookSecret = env.razorpayWebhookSecret;

    if (!this.keyId || !this.keySecret) {
      throw new Error(
        'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set when ' +
          'PAYMENT_ADAPTER=razorpay. Set them in the server env or fall ' +
          'back to PAYMENT_ADAPTER=mock for local dev.',
      );
    }

    this.client = new Razorpay({
      key_id: this.keyId,
      key_secret: this.keySecret,
    });

    this.logger.log(
      `Initialized RazorpayPaymentAdapter (key=${this.keyId.slice(0, 11)}…)`,
    );
  }

  // ── PaymentPort: charge ──────────────────────────────────────────────
  //
  // Server-initiated charges are not supported in this flow. The
  // SubscriptionsService and AddOnsService route through the explicit
  // create-order / verify endpoints in the controllers. This method is
  // only reachable from the auto-renewal scheduler, which we let fail
  // until the subscriptions flow lands in a later phase.

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    this.logger.warn(
      `charge() called for user=${req.userId} amount=${req.amountMinor} ` +
        `idempotencyKey=${req.idempotencyKey} — server-initiated charges ` +
        `are not supported by RazorpayPaymentAdapter. Returning failure ` +
        `so the caller can retry via the interactive Checkout flow.`,
    );
    return {
      success: false,
      error:
        'razorpay_server_initiated_charge_unsupported — use createOrder + verifyPayment',
    };
  }

  // ── PaymentPort: createMandate / cancelMandate ───────────────────────
  //
  // Razorpay Subscriptions API integration is deferred. Auto-renewals
  // are not yet wired through Razorpay; until then the scheduler will
  // simply log a failed renewal and lapse the subscription after the
  // grace window.

  async createMandate(req: MandateRequest): Promise<ChargeResult> {
    this.logger.warn(
      `createMandate() called for user=${req.userId} — Razorpay Subscriptions ` +
        `API not yet integrated. Returning failure.`,
    );
    return {
      success: false,
      error: 'razorpay_subscriptions_not_implemented',
    };
  }

  async cancelMandate(_userId: string, _mandateRef: string): Promise<void> {
    // No-op: nothing to cancel because we don't create mandates yet.
  }

  // ── Razorpay-specific helpers used by controllers ────────────────────

  /**
   * Creates a Razorpay Order. The `receipt` field carries our internal
   * idempotency key (truncated to Razorpay's 40-char limit) so retried
   * client calls do not create duplicate orders for the same intent.
   *
   * The returned `orderId` plus `keyId` are passed to the client, which
   * opens Razorpay Checkout. The user pays inside Checkout; on success,
   * Checkout calls back into the client with the payment id + signature
   * which we then verify in {@link verifyPayment}.
   */
  async createOrder(req: ChargeRequest): Promise<OrderCreationResult> {
    const receipt = req.idempotencyKey.slice(0, 40);

    const order = (await this.client.orders.create({
      amount: req.amountMinor,
      currency: req.currency,
      receipt,
      notes: {
        userId: req.userId,
        idempotencyKey: req.idempotencyKey,
        ...(req.description ? { description: req.description } : {}),
      },
    })) as unknown as RazorpayOrder;

    this.logger.log(
      `Created Razorpay order id=${order.id} amount=${order.amount} ` +
        `currency=${order.currency} receipt=${order.receipt} userId=${req.userId}`,
    );

    return {
      orderId: order.id,
      amountMinor: order.amount,
      currency: order.currency as 'INR' | 'USD',
      keyId: this.keyId,
      idempotencyKey: req.idempotencyKey,
    };
  }

  /**
   * Verifies the {orderId, paymentId, signature} triple returned by
   * Razorpay Checkout's `handler` callback. Returns the verified payment
   * id (stored as `provider_ref` on our `payments` row) when the signature
   * matches, throws otherwise.
   *
   * Algorithm (per Razorpay docs):
   *   expected = HMAC_SHA256(orderId + '|' + paymentId, keySecret)
   *   match    = constant-time compare(expected, razorpaySignature)
   */
  verifyPayment(input: VerifyPaymentInput): { providerRef: string } {
    const payload = `${input.razorpayOrderId}|${input.razorpayPaymentId}`;
    const expected = createHmac('sha256', this.keySecret)
      .update(payload)
      .digest('hex');

    const match = this.constantTimeEquals(expected, input.razorpaySignature);
    if (!match) {
      this.logger.warn(
        `Razorpay payment signature mismatch order=${input.razorpayOrderId} ` +
          `payment=${input.razorpayPaymentId}`,
      );
      throw new Error('razorpay_signature_invalid');
    }

    return { providerRef: input.razorpayPaymentId };
  }

  // ── PaymentPort: parseWebhook ────────────────────────────────────────
  //
  // Validates X-Razorpay-Signature against RAZORPAY_WEBHOOK_SECRET, then
  // normalizes the event into our generic WebhookEvent shape. We currently
  // map four event types — payment.captured, payment.failed,
  // refund.processed, payment.dispute.created — onto the four entries in
  // our WebhookEvent.type union. Anything else is rejected so unfamiliar
  // event types don't silently slip through.

  async parseWebhook(rawBody: Buffer, signature: string): Promise<WebhookEvent> {
    if (!this.webhookSecret) {
      throw new Error(
        'RAZORPAY_WEBHOOK_SECRET is not configured — webhook validation cannot proceed',
      );
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (!this.constantTimeEquals(expected, signature)) {
      this.logger.warn('Razorpay webhook signature mismatch');
      throw new Error('razorpay_webhook_signature_invalid');
    }

    const parsed = JSON.parse(rawBody.toString('utf-8')) as RazorpayWebhookPayload;
    return this.normalizeWebhook(parsed);
  }

  // ── Internals ────────────────────────────────────────────────────────

  private normalizeWebhook(payload: RazorpayWebhookPayload): WebhookEvent {
    const type = this.mapEventType(payload.event);
    const paymentEntity = payload.payload?.payment?.entity;
    const refundEntity = payload.payload?.refund?.entity;

    const providerRef =
      paymentEntity?.id ?? refundEntity?.payment_id ?? '(unknown)';
    const amountMinor = paymentEntity?.amount ?? refundEntity?.amount;
    const currency = paymentEntity?.currency ?? refundEntity?.currency;
    const userId =
      paymentEntity?.notes?.userId ?? refundEntity?.notes?.userId ?? undefined;

    // refund.processed and payment.dispute.created carry the reversal time
    // in different fields; pick whichever is present.
    const reversedAt = refundEntity?.created_at
      ? new Date(refundEntity.created_at * 1000)
      : undefined;

    return {
      type,
      providerRef,
      userId: userId ?? undefined,
      amountMinor,
      currency,
      reversedAt,
      rawPayload: payload,
    };
  }

  private mapEventType(event: string): WebhookEvent['type'] {
    switch (event) {
      case 'payment.captured':
        return 'charge.succeeded';
      case 'payment.failed':
        return 'charge.failed';
      case 'refund.processed':
      case 'refund.created':
        return 'charge.refunded';
      case 'payment.dispute.created':
      case 'payment.dispute.lost':
        return 'chargeback';
      case 'subscription.cancelled':
        return 'mandate.canceled';
      default:
        throw new Error(`razorpay_webhook_unsupported_event:${event}`);
    }
  }

  /** Constant-time comparison guarded against length mismatches. */
  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
  }
}

// ── Razorpay webhook payload shape (subset we care about) ────────────────

interface RazorpayWebhookPayload {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id: string;
        amount: number;
        currency: string;
        order_id?: string;
        notes?: Record<string, string>;
      };
    };
    refund?: {
      entity?: {
        payment_id: string;
        amount: number;
        currency: string;
        created_at: number; // unix seconds
        notes?: Record<string, string>;
      };
    };
  };
}
