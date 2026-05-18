// ── MockPaymentAdapter ────────────────────────────────────────────────────
//
// In-memory payment adapter for tests and local development.
// Always succeeds; records every charge in `charges` for test inspection.
// Selected when PAYMENT_ADAPTER=mock.

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PaymentPort,
  ChargeRequest,
  ChargeResult,
  MandateRequest,
  WebhookEvent,
} from '../ports/payment.port';

export interface RecordedCharge {
  type: 'charge' | 'mandate';
  request: ChargeRequest | MandateRequest;
  providerRef: string;
  recordedAt: Date;
}

@Injectable()
export class MockPaymentAdapter extends PaymentPort {
  /** In-memory log of all charges and mandates — inspect in tests. */
  readonly charges: RecordedCharge[] = [];

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const providerRef = `mock_${randomUUID()}`;
    this.charges.push({
      type: 'charge',
      request: req,
      providerRef,
      recordedAt: new Date(),
    });
    return { success: true, providerRef };
  }

  async createMandate(req: MandateRequest): Promise<ChargeResult> {
    const providerRef = `mock_${randomUUID()}`;
    this.charges.push({
      type: 'mandate',
      request: req,
      providerRef,
      recordedAt: new Date(),
    });
    return { success: true, providerRef };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async cancelMandate(_userId: string, _mandateRef: string): Promise<void> {
    // No-op in mock — mandate cancellation always succeeds silently.
  }

  async parseWebhook(rawBody: Buffer, _signature: string): Promise<WebhookEvent> {
    // Parse the raw body as JSON and return it as a WebhookEvent.
    // The mock does not validate the signature.
    const parsed = JSON.parse(rawBody.toString('utf-8')) as WebhookEvent;
    return parsed;
  }

  /** Convenience helper for tests: clear recorded charges between test cases. */
  reset(): void {
    this.charges.length = 0;
  }
}
