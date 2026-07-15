import { Request, Response, NextFunction } from 'express';
import { getLogger } from '../../observability/src/index';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { getRedis } from '../../auth/src/redis-client';
import { z } from 'zod';

const logger = getLogger('security:rate-limit');

export interface RateLimiterOptions {
  windowSeconds?: number;
  maxRequests?: number;
  keyFn?: (req: Request) => string;
}

/**
 * Real Redis sliding-window rate limiter (ZSET-based sliding window log).
 * Fails CLOSED: if Redis or config is unavailable, requests are rejected
 * with 503 rather than silently let through — matches the "Secure Fail"
 * intent this file always claimed but never actually implemented.
 */
export function rateLimiter(opts: RateLimiterOptions = {}) {
  const windowSeconds = opts.windowSeconds ?? 60;
  const maxRequests = opts.maxRequests ?? 100;
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip || 'unknown');

  return async (req: Request, res: Response, next: NextFunction) => {
    let config: unknown;
    try {
      config = loadConfig('security', z.any());
    } catch (err) {
      logger.fatal({ err }, 'RATE LIMITER FAILURE - could not load security config, failing closed');
      return res.status(503).json({ error: 'SECURITY_OFFLINE', message: 'System under maintenance.' });
    }
    if (!config) {
      logger.fatal('RATE LIMITER FAILURE - security config missing, failing closed');
      return res.status(503).json({ error: 'SECURITY_OFFLINE', message: 'System under maintenance.' });
    }

    const identifier = keyFn(req);
    const redisKey = `ratelimit:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    try {
      const redis = getRedis();
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      pipeline.zadd(redisKey, now, `${now}-${Math.random().toString(36).slice(2, 8)}`);
      pipeline.zcard(redisKey);
      pipeline.expire(redisKey, windowSeconds);
      const results = await pipeline.exec();

      if (!results) {
        throw new Error('Redis pipeline returned no results');
      }

      const [, countValue] = results[2] as [Error | null, number];

      if (countValue > maxRequests) {
        res.setHeader('Retry-After', String(windowSeconds));
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: `Too many requests. Limit is ${maxRequests} per ${windowSeconds}s.`,
        });
      }

      next();
    } catch (err) {
      // Fail closed: if Redis is unreachable we cannot enforce the limit,
      // so we reject rather than silently letting every request through.
      logger.fatal({ err }, 'RATE LIMITER FAILURE - Redis unavailable, failing closed');
      return res.status(503).json({ error: 'SECURITY_OFFLINE', message: 'System under maintenance.' });
    }
  };
}

// SWAP FIX: Provide the class structure Veridact expects
export const RedisRateLimiter = {
  create: (opts: RateLimiterOptions = {}) => rateLimiter(opts),
};
