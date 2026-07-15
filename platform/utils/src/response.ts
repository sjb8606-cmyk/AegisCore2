/**
 * platform/utils/src/response.ts
 *
 * Standardised HTTP response helpers.
 * All API responses follow the same envelope structure.
 */

import { Response } from 'express';
import { trace } from '@opentelemetry/api';

export interface SuccessResponse<T> {
  success:   true;
  data:      T;
  meta?:     Record<string, unknown>;
  requestId: string;
  timestamp: string;
}

export interface ErrorResponse {
  success:   false;
  error:     string;
  message:   string;
  details?:  unknown;
  requestId: string;
  timestamp: string;
}

// ── Get trace/request ID for response correlation ─────────────

function getRequestId(): string {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId || generateId();
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Response helpers ──────────────────────────────────────────

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  const body: SuccessResponse<T> = {
    success:   true,
    data,
    meta,
    requestId: getRequestId(),
    timestamp: new Date().toISOString(),
  };
  return res.status(200).json(body);
}

export function created<T>(res: Response, data: T): Response {
  const body: SuccessResponse<T> = {
    success:   true,
    data,
    requestId: getRequestId(),
    timestamp: new Date().toISOString(),
  };
  return res.status(201).json(body);
}

export function noContent(res: Response): Response {
  return res.status(204).end();
}

export function accepted<T>(res: Response, data?: T): Response {
  const body: SuccessResponse<T | null> = {
    success:   true,
    data:      data ?? null,
    requestId: getRequestId(),
    timestamp: new Date().toISOString(),
  };
  return res.status(202).json(body);
}

// ── Validation middleware ──────────────────────────────────────

import { Request, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError, ErrorCode } from './errors';

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new AppError('Validation failed', ErrorCode.UNPROCESSABLE, result.error.errors));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new AppError('Invalid query parameters', ErrorCode.BAD_REQUEST, result.error.errors));
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}
