// ── PaymentPort — provider-agnostic payment interface ────────────────────
//
// All payment operations go through this abstract class. The concrete
// adapter is injected via NestJS DI and selected by the PAYMENT_ADAPTER
// environment variable:
//   'razorpay' → RazorpayPaymentAdapter  (default)
//   'stripe'   → StripePaymentAdapter
//   'mock'     → MockPaymentAdapter      (tests / local dev)
//
// Swapping providers requires only a new adapter class — no changes to
// SubscriptionsService or AddOnsService.

export interface ChargeRequest {
  userId: string;
  /** Amount in minor currency units (paise for INR, cents for USD). */
  amountMinor: number;
  currency: 'INR' | 'USD';
  /** Format: '{action}:{subId}:{tier}:{periodStart}' */
  idempotencyKey: string;
  description?: string;
}

export interface ChargeResult {
  success: boolean;
  /** Opaque string stored in payments.provider_ref. */
  providerRef?: string;
  error?: string;
}

export interface MandateRequest {
  userId: string;
  amountMinor: number;
  currency: 'INR' | 'USD';
  idempotencyKey: string;
}

export interface WebhookEvent {
  type:
    | 'charge.succeeded'
    | 'charge.failed'
    | 'charge.refunded'
    | 'chargeback'
    | 'mandate.canceled';
  /** Opaque provider reference — matches payments.provider_ref. */
  providerRef: string;
  /** Resolved by the adapter from the provider payload. */
  userId?: string;
  amountMinor?: number;
  currency?: string;
  reversedAt?: Date;
  /** Stored for audit; never parsed by business logic. */
  rawPayload: unknown;
}

export abstract class PaymentPort {
  abstract charge(req: ChargeRequest): Promise<ChargeResult>;
  abstract createMandate(req: MandateRequest): Promise<ChargeResult>;
  abstract cancelMandate(userId: string, mandateRef: string): Promise<void>;
  /** Validate provider signature and parse into a normalized WebhookEvent. */
  abstract parseWebhook(rawBody: Buffer, signature: string): Promise<WebhookEvent>;
}
