// ── Global HTTP exception filter ─────────────────────────────
// Catches all exceptions and returns a consistent response shape:
// { data: null, error: { code, message }, requestId }

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError, AppErrorCode } from '../errors/app.errors';

/**
 * Pull the cause chain off of an Error so we can log the root reason
 * (Drizzle wraps the pg error, which wraps the original failure).
 */
function describeCauseChain(err: unknown, depth = 0): string {
  if (depth > 4 || !err || typeof err !== 'object') return '';
  const anyErr = err as any;
  const parts: string[] = [];

  if (anyErr.message) parts.push(`msg="${anyErr.message}"`);
  // PostgreSQL-specific fields exposed by node-postgres.
  if (anyErr.code) parts.push(`pgcode=${anyErr.code}`);
  if (anyErr.detail) parts.push(`detail="${anyErr.detail}"`);
  if (anyErr.hint) parts.push(`hint="${anyErr.hint}"`);
  if (anyErr.table) parts.push(`table=${anyErr.table}`);
  if (anyErr.column) parts.push(`column=${anyErr.column}`);
  if (anyErr.constraint) parts.push(`constraint=${anyErr.constraint}`);
  if (anyErr.schema) parts.push(`schema=${anyErr.schema}`);

  let out = parts.join(' ');
  if (anyErr.cause) {
    const inner = describeCauseChain(anyErr.cause, depth + 1);
    if (inner) out += `\n  caused by: ${inner}`;
  }
  return out;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as any).requestId || 'unknown';

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = AppErrorCode.UNKNOWN_ERROR;
    let message = 'Internal server error';

    if (exception instanceof AppError) {
      statusCode = exception.statusCode;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && (exceptionResponse as any).message) {
        const msg = (exceptionResponse as any).message;
        message = Array.isArray(msg) ? msg[0] : msg;
      } else {
        message = exception.message;
      }
      code = AppErrorCode.VALIDATION_ERROR;
    } else if (exception instanceof Error) {
      const chain = describeCauseChain(exception);
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}  [requestId=${requestId}]\n${chain}`,
        exception.stack,
      );

      // Surface the root PG error message to the client when not in
      // production so the Flutter app can display it verbatim.
      if (process.env.NODE_ENV !== 'production') {
        message = exception.message;
      }
    }

    response.status(statusCode).json({
      data: null,
      error: { code, message },
      requestId,
    });
  }
}
