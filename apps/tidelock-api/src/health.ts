import { Router, Request, Response as ExpressResponse } from 'express';
import { Pool } from 'pg';

const router = Router();
const TIMEOUT = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '5000', 10);

router.get('/health', (_req: Request, res: ExpressResponse) => {
  res.status(200).json({
    status: 'ok',
    service: process.env.SERVICE_NAME || 'tidelock-api',
    version: process.env.SERVICE_VERSION || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

router.get('/ready', async (_req: Request, res: ExpressResponse) => {
  const start = Date.now();
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${TIMEOUT}ms`)), TIMEOUT)),
    ]);
    await pool.end();
    res.status(200).json({ status: 'ready', checks: { postgres: { healthy: true, latencyMs: Date.now() - start } } });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', checks: { postgres: { healthy: false, error: String(err) } } });
  }
});

export { router as healthRouter };
