import 'dotenv/config';
import '../../../platform/observability/src/tracing';
import express from 'express';
import path from 'path';
const { json } = require('body-parser');
import { requireAuth } from '../../../platform/auth/src/index';
import { healthRouter } from './health';
import { tenantResolver } from '../../../platform/tenancy/src/index';
import { observabilityMiddleware } from '../../../platform/observability/src/index';
import { globalErrorHandler } from '../../../platform/utils/src/index';
import { mountApp } from '../../../platform/app-loader/src/index';
import { createApp as createVeridactApp } from '../../../src/app';

const app = express();
app.use(json());
app.use(observabilityMiddleware());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/health', healthRouter);

// Config-driven assembly — reads config/apps/example-api.json and mounts
// only the cores it declares, reporting any drift between the config and
// the real routes/ folder instead of silently mounting whatever happens
// to sit in the directory. This replaces a hand-rolled auto-discovery
// loop that had no config file governing it at all — nothing could ever
// tell you if a route existed without being declared, or was declared
// without actually existing.
const mountReport = mountApp(app, {
  appId: 'example-api',
  routesDir: path.join(__dirname, 'routes'),
  requireAuth,
  tenantResolver,
});

console.log(`📡 [example-api] mounted cores: ${mountReport.mounted.length}`);
if (mountReport.missingRouteFile.length > 0) {
  console.warn(`⚠️  [example-api] declared in config but missing route file: ${mountReport.missingRouteFile.join(', ')}`);
}
if (mountReport.unlistedInConfig.length > 0) {
  console.warn(`⚠️  [example-api] route file exists but not declared in config: ${mountReport.unlistedInConfig.join(', ')}`);
}

// Veridact — mounted as a real Express sub-app under a path prefix
// rather than through mountApp()'s per-core convention. This is
// deliberate, not a shortcut: mountApp() always wraps a mounted core in
// the platform's own requireAuth(), which would stack on top of
// Veridact's own internal requireApiKey middleware and create two
// competing auth layers. Veridact's interim API-key auth is a real,
// separate, already-known gap (tracked in the build progress doc) —
// replacing it is its own task, not something to trigger accidentally
// as a side effect of mounting. This line solves exactly one problem —
// Veridact now runs inside the one shared server/process/deployment
// instead of needing its own — and touches nothing inside Veridact
// itself. Real routes preserved exactly as built: POST /veridact/verify,
// GET /veridact/replay/:id, GET /veridact/receipts, /changes, /alerts,
// /health, plus its actions/conversation routes.
app.use('/veridact', createVeridactApp());

app.use(globalErrorHandler);

app.listen(3000, () => {
  console.log('[example-api] Listening on port 3000 (development)');
});
