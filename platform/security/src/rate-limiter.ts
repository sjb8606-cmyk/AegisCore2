import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { getLogger, rateLimitHits } from '@platform/observability';

const logger = getLogger('security:rate-limit');

let _redis: Redis | null = null;
function getRedisClient(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return _redis;
}

export interface RateLimiterOptions {
  /** Window size in ms. Defaults to 60s. */
  windowMs?: number;
  /** Max requests allowed per window. */
  max?: number;
  /** @deprecated use `max` — kept for backwards compatibility */
  maxRequests?: number;
  /** How to identify the caller. Defaults to authenticated sub, else IP. */
  keyFn?: (req: Request) => string;
  /** Return true to bypass rate limiting entirely for this request. */
  skip?: (req: Request) => boolean;
}

/**
 * Real Redis sliding-window rate limiter (ZSET-based sliding window log),
 * with hard-block escalation on extreme abuse and standard rate-limit
 * response headers. Fails CLOSED: if Redis is unavailable, requests are
 * rejected with 503 rather than silently let through.
 */
export function rateLimiter(options: RateLimiterOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? options.maxRequests ?? 100;
  const keyFn = options.keyFn ?? ((req: any) =>
    req.auth?.sub ? `user:${req.auth.sub}` : `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`
  );

  return async (req: any, res: Response, next: NextFunction) => {
    if (options.skip && options.skip(req)) {
      return next();
    }

    const identifier = keyFn(req);
    const countKey = `platform:rl:${identifier}`;
    const blockKey = `platform:rl:block:${identifier}`;

    try {
      const redis = getRedisClient();

      const isBlocked = await redis.exists(blockKey);
      if (isBlocked) {
        rateLimitHits.add(1, { blocked: 'true' });
        res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: 'Too many requests. This client is temporarily blocked.',
        });
      }

      const now = Date.now();
      const windowStart = now - windowMs;
      const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;

      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(countKey, 0, windowStart);
      pipeline.zadd(countKey, now, member);
      pipeline.zcard(countKey);
      pipeline.pexpire(countKey, windowMs);
      const results = await pipeline.exec();

      if (!results) {
        throw new Error('Redis pipeline returned no results');
      }

      const [, count] = results[2] as [Error | null, number];

      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));

      if (count > max) {
        rateLimitHits.add(1, { blocked: 'false' });

        // Escalate to a temporary hard block on extreme abuse (well past
        // the limit) so repeat offenders get short-circuited immediately
        // on their next request instead of re-running the full check.
        if (count > max * 3) {
          await redis.set(blockKey, '1', 'PX', windowMs * 5);
        }

        res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: `Too many requests. Limit is ${max} per ${Math.round(windowMs / 1000)}s.`,
        });
      }

      next();
    } catch (err) {
      // Fail closed: if Redis is unreachable we cannot enforce the limit,
      // so we reject rather than silently letting every request through.
      logger.error({ err }, 'RATE LIMITER FAILURE - Redis unavailable, failing closed');
      return res.status(503).json({ error: 'SECURITY_OFFLINE', message: 'System under maintenance.' });
    }
  };
}

// SWAP FIX: Provide the class structure Veridact expects
export const RedisRateLimiter = {
  create: (opts: RateLimiterOptions = {}) => rateLimiter(opts),
};
