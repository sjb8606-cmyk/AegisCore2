/**
 * apps/gateway — the real "one server, one deployment, one bill" entrypoint.
 *
 * Built ADDITIVELY, alongside tidelock-api/example-api/golden-key-api, which
 * all keep running unchanged for now (hard constraint: tidelock-api must
 * keep working at every step — cut real traffic over to this gateway only
 * once it's been proven, don't rip out the working servers first).
 *
 * Route contract: identical, unprefixed /api/<core>/... for every app,
 * including tidelock — selection happens by WHICH TENANT is calling
 * (resolveAppIdForTenant), not by URL namespace. See
 * platform/app-loader/src/dispatch.ts for the full design rationale.
 */

import express from 'express';
import helmet from 'helmet';
import path from 'path';
const { json } = require('body-parser');
import { requireAuth } from '../../../platform/auth/src/index';
import { globalErrorHandler } from '../../../platform/utils/src/index';
import { createDynamicDispatch } from '../../../platform/app-loader/src/dispatch';
import { healthRouter } from './health';
import { onboardingRouter } from './onboarding';

const app = express();
app.use(helmet());
app.use(json());
app.use(healthRouter);

// Onboarding is mounted AHEAD of the dynamic-dispatch catch-all, on
// purpose: a brand-new tenant has no tenant_apps row yet, so the dispatch
// layer (which requires a resolved app_id to pick a Router) can't serve
// them. Onboarding only needs a verified caller identity (requireAuth),
// not an app assignment — it's what CREATES that assignment. Note this
// also reserves "onboarding" as a core name no app config should ever
// declare — none currently do.
app.use('/api/onboarding', requireAuth(), onboardingRouter);

const dispatch = createDynamicDispatch({
  appRoutesDirs: {
    tidelock: path.join(__dirname, '../../tidelock-api/src/routes'),
    'example-api': path.join(__dirname, '../../example-api/src/routes'),
    'golden-key': path.join(__dirname, '../../golden-key-api/src/routes'),
  },
});

for (const [appId, report] of Object.entries(dispatch.reports)) {
  console.log(`📡 [gateway] built "${appId}": mounted=${report.mounted.length} missing=${report.missingRouteFile.length} unlisted=${report.unlistedInConfig.length}`);
  if (report.missingRouteFile.length > 0) {
    console.warn(`⚠️  [gateway:${appId}] declared in config but missing route file: ${report.missingRouteFile.join(', ')}`);
  }
  if (report.unlistedInConfig.length > 0) {
    console.warn(`⚠️  [gateway:${appId}] route file exists but not declared in config: ${report.unlistedInConfig.join(', ')}`);
  }
}

app.use('/api', dispatch.middleware);

app.use(globalErrorHandler);

// Deliberately NOT 3001/3000/3040 (tidelock/example/golden-key's real
// ports) — this runs alongside them during the proving-out phase, not in
// place of them yet. Cut over (retire the three standalone servers, move
// this to the real port) only after real requests against this gateway
// have been verified end to end.
const PORT = parseInt(process.env.PORT || process.env.GATEWAY_PORT || '3999', 10);
app.listen(PORT, () => {
  console.log(`[gateway] Listening on port ${PORT}`);
});

export { app };
