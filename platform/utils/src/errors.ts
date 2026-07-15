/**
 * platform/utils/src/errors.ts
 *
 * Unified error framework.
 * All platform errors extend AppError for consistent HTTP mapping.
 */

// ── Error codes ───────────────────────────────────────────────

export enum ErrorCode {
  // 4xx
  BAD_REQUEST        = 'BAD_REQUEST',
  UNAUTHORIZED       = 'UNAUTHORIZED',
  FORBIDDEN          = 'FORBIDDEN',
  NOT_FOUND          = 'NOT_FOUND',
  CONFLICT           = 'CONFLICT',
  UNPROCESSABLE      = 'UNPROCESSABLE',
  RATE_LIMITED       = 'RATE_LIMITED',
  // 5xx
  INTERNAL           = 'INTERNAL',
  NOT_IMPLEMENTED    = 'NOT_IMPLEMENTED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT            = 'TIMEOUT',
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.BAD_REQUEST]:         400,
  [ErrorCode.UNAUTHORIZED]:        401,
  [ErrorCode.FORBIDDEN]:           403,
  [ErrorCode.NOT_FOUND]:           404,
  [ErrorCode.CONFLICT]:            409,
  [ErrorCode.UNPROCESSABLE]:       422,
  [ErrorCode.RATE_LIMITED]:        429,
  [ErrorCode.INTERNAL]:            500,
  [ErrorCode.NOT_IMPLEMENTED]:     501,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.TIMEOUT]:             504,
};

// ── AppError ──────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code:       ErrorCode;
  public readonly statusCode: number;
  public readonly details?:   unknown;
  public readonly requestId?: string;

  constructor(
    message:   string,
    code:      ErrorCode = ErrorCode.INTERNAL,
    details?:  unknown,
    requestId?: string,
  ) {
    super(message);
    this.name      = 'AppError';
    this.code      = code;
    this.statusCode = HTTP_STATUS[code] ?? 500;
    this.details   = details;
    this.requestId = requestId;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      error:     this.code,
      message:   this.message,
      details:   this.details,
      requestId: this.requestId,
    };
  }
}

// ── Express error handler middleware ──────────────────────────

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function globalErrorHandler(
  err:  unknown,
  req:  Request,
  res:  Response,
  next: NextFunction,
): void {
  // Already sent
  if (res.headersSent) return;

  // ZodError → 422
  if (err instanceof ZodError) {
    res.status(422).json({
      error:   'UNPROCESSABLE',
      message: 'Validation failed',
      details: err.errors,
    });
    return;
  }

  // AppError → mapped status
  if (err instanceof AppError) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Unknown → 500 (never leak internal details)
  console.error('Unhandled error:', err);
  res.status(500).json({
    error:   'INTERNAL',
    message: 'An unexpected error occurred',
  });
}
