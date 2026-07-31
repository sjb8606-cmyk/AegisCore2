/**
 * Veridact v1.0 — Rate Limiting Middleware
 */

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth';

function keyGenerator(req: Request): string {
  const authedReq = req as AuthenticatedRequest;
  if (authedReq.actor?.id && authedReq.tenantId) {
    return `${authedReq.tenantId}:${authedReq.actor.id}`;
  }
  return (
    (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? 'unknown'
  );
}

function rateLimitHandler(_req: Request, res: any): void {
  res.status(429).json({
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please slow down.',
    retry_after_seconds: 60,
  });
}

export const verifyRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test',
});

export const replayRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test',
});

export const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 120,
  keyGenerator,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test',
});
