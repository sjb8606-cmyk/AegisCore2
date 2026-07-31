/**
 * Veridact v1.0 — Error Handler Middleware
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../db/logger';

interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation Error',
      message: 'Request payload failed schema validation',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
    });
    return;
  }

  const statusCode = err.statusCode ?? 500;
  const isServerError = statusCode >= 500;

  logger.error(
    {
      err,
      method: req.method,
      path: req.path,
      status: statusCode,
    },
    'request.error'
  );

  res.status(statusCode).json({
    error: isServerError ? 'Internal Server Error' : err.message,
    message: isServerError
      ? 'An unexpected error occurred. Please try again later.'
      : err.message,
    ...(process.env.NODE_ENV !== 'production' && isServerError
      ? { debug: err.message }
      : {}),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
}
