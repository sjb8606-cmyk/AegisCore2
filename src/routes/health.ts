/**
 * Veridact v1.0 — Health Route
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { checkDbHealth } from '../db/client';
import type { HealthResponse } from '../types';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const dbOk = await checkDbHealth();

  const payload: HealthResponse = {
    status: dbOk ? 'ok' : 'degraded',
    version: process.env.npm_package_version ?? 'unknown',
    timestamp: new Date().toISOString(),
    checks: {
      db: dbOk ? 'ok' : 'error',
    },
  };

  res.status(dbOk ? 200 : 503).json(payload);
});
