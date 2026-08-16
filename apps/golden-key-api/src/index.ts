/**
 * apps/golden-key-api
 *
 * Thin entrypoint for Golden Key. Assembles cores declared in
 * config/apps/golden-key.json via mountApp() — matches
 * apps/tidelock-api's real, established pattern exactly.
 */

import express from 'express';
import path from 'path';
import { mountApp } from '../../../platform/app-loader/src/index';
import { requireAuth } from '../../../platform/auth/src/index';
import { tenantResolver } from '../../../platform/tenancy/src/index';
import { getLogger } from '../../../platform/observability/src/index';

const logger = getLogger('golden-key-api');
const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3040);

const mountReport = mountApp(app, {
  appId: 'golden-key',
  routesDir: path.join(__dirname, 'routes'),
  requireAuth,
  tenantResolver,
});

logger.info({ mountReport }, 'Golden Key routes mounted');

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: 'golden-key', version: '0.1.0' });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Golden Key API listening');
});
