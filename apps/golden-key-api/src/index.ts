/**
 * apps/golden-key-api — thin entrypoint.
 *
 * The dev-auth-header shim that used to sit here (GOLDEN_KEY_DEV_AUTH=1
 * injecting a fake req.auth, no real token check) is removed — same
 * category of gap platform/auth/src/oidc.ts's own header comment already
 * describes having removed once (the static-secret "side door" bypass).
 * Local/dev testing should use a real (even short-lived, test-issued)
 * OIDC token against requireAuth(), same as tidelock-api and example-api.
 *
 * Also converted from a hand-mounted single custody router to the real
 * config-driven mountApp() convention — config/apps/golden-key.json now
 * actually governs what's mounted, and drift (declared-but-missing,
 * present-but-undeclared) is reported instead of invisible.
 *
 * NOTE: this changes golden-key's real URLs — routes now live under
 * /api/custody-vault/... and /api/custody-receipt/... instead of the old
 * flat /api/vaults, /api/assets, /api/receipts paths. No live customer on
 * golden-key yet, so this is safe now; would NOT be safe to do silently
 * on tidelock-api.
 */

import express from 'express';
import path from 'path';
const { json } = require('body-parser');
import { requireAuth } from '../../../platform/auth/src/index';
import { tenantResolver } from '../../../platform/tenancy/src/index';
import { globalErrorHandler } from '../../../platform/utils/src/index';
import { mountApp } from '../../../platform/app-loader/src/index';
import { getLogger } from '../../../platform/observability/src/index';
import { healthRouter } from './health';

const logger = getLogger('golden-key-api');
const app = express();
app.use(json({ limit: '10mb' }));
app.use(healthRouter);

const mountReport = mountApp(app, {
  appId: 'golden-key',
  routesDir: path.join(__dirname, 'routes'),
  requireAuth,
  tenantResolver,
});

logger.info({ mounted: mountReport.mounted }, '[golden-key-api] mounted cores');
if (mountReport.missingRouteFile.length > 0) {
  logger.warn({ missing: mountReport.missingRouteFile }, '[golden-key-api] declared in config but missing route file');
}
if (mountReport.unlistedInConfig.length > 0) {
  logger.warn({ unlisted: mountReport.unlistedInConfig }, '[golden-key-api] route file exists but not declared in config');
}

app.use(globalErrorHandler);

const PORT = Number(process.env.PORT || 3040);

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Golden Key API listening');
  });
}

export default app;
export { app };
