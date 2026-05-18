// ── Subscriptions exception filter ───────────────────────────
// Maps subscription-domain error classes to HTTP status codes and
// a uniform JSON error envelope per design §Error Handling.
//
// Requirements: 3.2, 3.3, 3.4, 1.11, 25.3

import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import {
  CapExceededError,
  TierLockedError,
  ConcurrentLimitReachedError,
  InvalidDowngradeTargetError,
  CatalogUnavailableError,
  PaymentFailedError,
  SubscriptionNotFoundError,
  MissingSubscriptionForPayoutError,
  PaymentOwedError,
} from '../../modules/subscriptions/subscriptions.errors';

/**
 * Error-class → HTTP-status mapping per design §Error Handling:
 *
 * | Error class                                                                    | HTTP |
 * |--------------------------------------------------------------------------------|------|
 * | CapExceededError, TierLockedError, ConcurrentLimitReachedError,                | 422  |
 * | InvalidDowngradeTargetError                                                    |      |
 * | CatalogUnavailableError, PaymentFailedError                                    | 503  |
 * | SubscriptionNotFoundError, MissingSubscriptionForPayoutError                   | 404  |
 * | PaymentOwedError                                                               | 403  |
 */
@Catch(
  CapExceededError,
  TierLockedError,
  ConcurrentLimitReachedError,
  InvalidDowngradeTargetError,
  CatalogUnavailableError,
  PaymentFailedError,
  SubscriptionNotFoundError,
  MissingSubscriptionForPayoutError,
  PaymentOwedError,
)
export class SubscriptionsErrorFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = this.resolveStatus(exception);

    // Flat envelope per design §Error Handling:
    // { "error": "CAP_EXCEEDED", "feature": "ai_tool", "currentUsage": 25, ... }
    const body: Record<string, unknown> = {
      error: exception.code,
      message: exception.message,
    };

    // Attach context fields that are present on the specific error class.
    // Undefined fields are omitted so the client can rely on key presence.
    if (exception.feature !== undefined) body.feature = exception.feature;
    if (exception.currentTier !== undefined) body.currentTier = exception.currentTier;
    if (exception.currentUsage !== undefined) body.currentUsage = exception.currentUsage;
    if (exception.cap !== undefined) body.cap = exception.cap;
    if (exception.suggestedTier !== undefined) body.suggestedTier = exception.suggestedTier;
    if (exception.currentCount !== undefined) body.currentCount = exception.currentCount;
    if (exception.userId !== undefined) body.userId = exception.userId;
    if (exception.providerError !== undefined) body.providerError = exception.providerError;

    response.status(status).json(body);
  }

  private resolveStatus(exception: unknown): number {
    if (
      exception instanceof CapExceededError ||
      exception instanceof TierLockedError ||
      exception instanceof ConcurrentLimitReachedError ||
      exception instanceof InvalidDowngradeTargetError
    ) {
      return HttpStatus.UNPROCESSABLE_ENTITY; // 422
    }

    if (
      exception instanceof CatalogUnavailableError ||
      exception instanceof PaymentFailedError
    ) {
      return HttpStatus.SERVICE_UNAVAILABLE; // 503
    }

    if (
      exception instanceof SubscriptionNotFoundError ||
      exception instanceof MissingSubscriptionForPayoutError
    ) {
      return HttpStatus.NOT_FOUND; // 404
    }

    if (exception instanceof PaymentOwedError) {
      return HttpStatus.FORBIDDEN; // 403
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
