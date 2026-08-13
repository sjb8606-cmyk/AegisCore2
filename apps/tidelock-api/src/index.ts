import express from 'express';
import helmet from 'helmet';
import path from 'path';
const { json } = require('body-parser');
import { requireAuth } from '../../../platform/auth/src/index';
import { tenantResolver } from '../../../platform/tenancy/src/index';
import { globalErrorHandler } from '../../../platform/utils/src/index';
import { mountApp } from '../../../platform/app-loader/src/index';
import { healthRouter } from './health';
import { onboardingRouter } from './onboarding';

const app = express();
app.use(helmet());
app.use(json());
app.use(healthRouter);

app.use('/api/onboarding', requireAuth(), onboardingRouter);

const mountReport = mountApp(app, {
  appId: 'tidelock',
  routesDir: path.join(__dirname, 'routes'),
  requireAuth,
  tenantResolver,
});

console.log(`📡 [tidelock-api] mounted cores: ${mountReport.mounted.join(', ') || '(none)'}`);
if (mountReport.missingRouteFile.length > 0) {
  console.warn(`⚠️  [tidelock-api] declared in config but missing route file: ${mountReport.missingRouteFile.join(', ')}`);
}
if (mountReport.unlistedInConfig.length > 0) {
  console.warn(`⚠️  [tidelock-api] route file exists but not declared in config: ${mountReport.unlistedInConfig.join(', ')}`);
}

app.use(globalErrorHandler);

const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen(PORT, () => {
  console.log(`[tidelock-api] Listening on port ${PORT}`);
});

export { app };
