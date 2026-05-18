// ── Typed application errors ─────────────────────────────────
// Use these instead of throwing raw strings or generic Errors.

export enum AppErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  PROVIDER_PERMISSION_DENIED = 'PROVIDER_PERMISSION_DENIED',
  PROVIDER_TOKEN_EXPIRED = 'PROVIDER_TOKEN_EXPIRED',
  PROVIDER_CONNECTION_REVOKED = 'PROVIDER_CONNECTION_REVOKED',
  DELETION_PENDING = 'DELETION_PENDING',
  DELETION_COMPLETED = 'DELETION_COMPLETED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Not authenticated') {
    super(AppErrorCode.UNAUTHORIZED, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(AppErrorCode.FORBIDDEN, message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(AppErrorCode.NOT_FOUND, message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(AppErrorCode.CONFLICT, message, 409);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(AppErrorCode.VALIDATION_ERROR, message, 400);
  }
}

export class ProviderError extends AppError {
  constructor(message: string) {
    super(AppErrorCode.PROVIDER_ERROR, message, 502);
  }
}
