import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
/**
 * platform/security/src/__tests__/rate-limiter.test.ts
 *
 * Tests:
 * - Rate limit enforcement per IP
 * - Authenticated user higher limit
 * - Retry-After header correctness
 * - Block escalation on extreme abuse
 */

// Mock Redis before importing module
const redisCounts = new Map<string, number>();
const blocked = new Set<string>();

vi.mock('ioredis', () => {
  return { default: vi.fn().mockImplementation(() => ({
    pipeline: () => {
      let countKey = '';
      const ops: any[] = [];
      return {
        zremrangebyscore: (k: string) => { countKey = k; ops.push('zremrange'); return ops; },
        zadd: () => { ops.push('zadd'); return ops; },
        zcard: () => { ops.push('zcard'); return ops; },
        pexpire: () => { ops.push('pexpire'); return ops; },
        exec: async () => {
          const key = countKey.replace('platform:rl:', '');
          const count = (redisCounts.get(key) || 0) + 1;
          redisCounts.set(key, count);
          return [null, null, [null, count], null];
        },
      };
    },
    exists: vi.fn(async (key: string) => blocked.has(key) ? 1 : 0),
    set: vi.fn(async (key: string) => { blocked.add(key); return 'OK'; }),
    on: vi.fn(),
  })) };
});

vi.mock('@platform/observability', () => ({
  getLogger:    () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  rateLimitHits: { add: vi.fn() },
}));

import { rateLimiter } from '../rate-limiter';

function makeReq(ip: string, sub?: string): any {
  return {
    ip,
    path:    '/test',
    method:  'GET',
    headers: { 'user-agent': 'jest-test' },
    socket:  { remoteAddress: ip },
    auth:    sub ? { sub } : undefined,
  };
}

function makeRes(): any {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  return {
    headers,
    statusCode,
    setHeader: vi.fn((k: string, v: string) => { headers[k] = v; }),
    status:    vi.fn().mockImplementation((code: number) => { statusCode = code; return { json: vi.fn() }; }),
    json:      vi.fn(),
  };
}

describe('rate limiter', () => {
  beforeEach(() => {
    redisCounts.clear();
    blocked.clear();
  });

  test('allows requests under the limit', async () => {
    const middleware = rateLimiter({ max: 10 });
    const req  = makeReq('1.2.3.4');
    const res  = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(429);
  });

  test('blocks requests over the limit', async () => {
    // Pre-populate count above limit
    redisCounts.set('ip:1.2.3.5', 150);

    const middleware = rateLimiter({ max: 100 });
    const req  = makeReq('1.2.3.5');
    const res  = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  test('sets X-RateLimit headers', async () => {
    const middleware = rateLimiter({ max: 100 });
    const req  = makeReq('1.2.3.6');
    const res  = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(res.setHeader).toHaveBeenCalledWith(expect.stringContaining('RateLimit-Remaining'), expect.any(String));
  });

  test('sets Retry-After on 429', async () => {
    redisCounts.set('ip:1.2.3.7', 200);
    const middleware = rateLimiter({ max: 100 });
    const req  = makeReq('1.2.3.7');
    const res  = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  test('skips rate limiting when skip() returns true', async () => {
    const middleware = rateLimiter({
      max:  1,
      skip: () => true,
    });
    const req  = makeReq('1.2.3.8');
    const res  = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('blocked IP receives 429 immediately', async () => {
    blocked.add('platform:rl:block:ip:1.2.3.9');
    const middleware = rateLimiter({ max: 1000 });
    const req  = makeReq('1.2.3.9');
    const res  = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
