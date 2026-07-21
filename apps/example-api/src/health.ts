/**
 * apps/example-api/src/health.ts
 *
 * Health:   /health  — liveness probe (always fast; no DB)
 * Readiness: /ready  — readiness probe (checks deps)
 */

import { Router, Request, Response as ExpressResponse } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { getLogger } from '@platform/observability';

const logger  = getLogger('health');
const router  = Router();
const TIMEOUT = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '5000', 10);

// ── Liveness ───────────────────────────────────────────────────

router.get('/health', (_req: Request, res: ExpressResponse) => {
  res.status(200).json({
    status:    'ok',
    service:   process.env.SERVICE_NAME    || 'example-api',
    version:   process.env.SERVICE_VERSION || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Readiness ──────────────────────────────────────────────────

router.get('/ready', async (_req: Request, res: ExpressResponse) => {
  const checks: Record<string, CheckResult> = {};
  let allHealthy = true;

  // ── Postgres ──────────────────────────────────────────────────
  if (process.env.READINESS_INCLUDE_DB !== 'false') {
    checks.postgres = await checkPostgres();
    if (!checks.postgres.healthy) allHealthy = false;
  }

  // ── Redis ─────────────────────────────────────────────────────
  if (process.env.READINESS_INCLUDE_REDIS !== 'false') {
    checks.redis = await checkRedis();
    if (!checks.redis.healthy) allHealthy = false;
  }

  // ── Vault ─────────────────────────────────────────────────────
  if (process.env.READINESS_INCLUDE_VAULT === 'true') {
    checks.vault = await checkVault();
    if (!checks.vault.healthy) allHealthy = false;
  }

  const status = allHealthy ? 200 : 503;

  if (!allHealthy) {
    logger.warn({ checks }, 'Readiness check failed');
  }

  res.status(status).json({
    status:    allHealthy ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  });
});

// ── Check helpers ──────────────────────────────────────────────

interface CheckResult {
  healthy:     boolean;
  latencyMs?:  number;
  error?:      string;
}

async function checkPostgres(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await Promise.race([
      pool.query('SELECT 1'),
      timeout(TIMEOUT),
    ]);
    await pool.end();
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect:          true,
    maxRetriesPerRequest: 1,
  });
  try {
    await Promise.race([redis.ping(), timeout(TIMEOUT)]);
    await redis.quit();
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

async function checkVault(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await Promise.race([
      fetch(`${process.env.VAULT_ADDR}/v1/sys/health`),
      timeout(TIMEOUT),
    ]) as globalThis.Response;
    const healthy = resp.status < 300 || resp.status === 429; // 429 = standby
    return { healthy, latencyMs: Date.now() - start };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  );
}

export { router as healthRouter };
