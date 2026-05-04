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
      // Log unexpected errors but don't expose internals
      this.logger.error(`Unhandled error on ${request.method} ${request.url}`, exception.stack);
    }

    response.status(statusCode).json({
      data: null,
      error: { code, message },
      requestId,
    });
  }
}
