/**
 * platform/auth/src/redis-client.ts
 * Shared Redis client for the auth package.
 */

import Redis from 'ioredis';
import { getLogger } from '@platform/observability';

const logger = getLogger('auth:redis');
let _client: Redis | null = null;

export function getRedis(): Redis {
  if (!_client) {
    _client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      keyPrefix:          process.env.REDIS_KEY_PREFIX || 'platform:',
      tls:                process.env.REDIS_TLS === 'true' ? {} : undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 2000),
      lazyConnect:   true,
    });

    _client.on('error',   (err)  => logger.error({ err }, 'Redis error'));
    _client.on('connect', ()     => logger.info('Redis connected'));
    _client.on('close',   ()     => logger.warn('Redis connection closed'));
  }
  return _client;
}

export async function closeRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
  }
}
