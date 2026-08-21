/**
 * apps/golden-key-api — thin entrypoint
 */

import express from 'express';
import { getLogger } from '@platform/observability';
import custodyRouter from './routes/custody';

const logger = getLogger('golden-key-api');
const app = express();
app.use(express.json({ limit: '10mb' }));

// Auth + tenant middleware should be mounted by app-loader in production.
// For local smoke tests, inject test headers via a small middleware:
app.use((req: any, _res, next) => {
  if (!req.auth && process.env.GOLDEN_KEY_DEV_AUTH === '1') {
    req.auth = {
      sub: process.env.GOLDEN_KEY_DEV_ACTOR || 'dev-actor',
      tenantId: process.env.GOLDEN_KEY_DEV_TENANT || '00000000-0000-4000-8000-0000000000gk',
    };
    req.tenantId = req.auth.tenantId;
  }
  next();
});

app.use('/api', custodyRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: 'golden-key', version: '0.1.0' });
});

// Error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  const status = err.status || err.statusCode || 500;
  const code = err.code || err.error || 'INTERNAL';
  logger.error({ err }, 'Request failed');
  res.status(status).json({
    error: code,
    message: err.message || 'Internal error',
  });
});

const PORT = Number(process.env.PORT || 3040);

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Golden Key API listening');
  });
}

export default app;
