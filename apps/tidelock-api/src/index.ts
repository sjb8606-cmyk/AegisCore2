import express from 'express';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
const { json } = require('body-parser');
import { requireAuth } from '../../../platform/auth/src/index';
import { tenantResolver } from '../../../platform/tenancy/src/index';
import { globalErrorHandler } from '../../../platform/utils/src/index';
import { healthRouter } from './health';
import { onboardingRouter } from './onboarding';

const app = express();
app.use(helmet());
app.use(json());
app.use(healthRouter);

app.use('/api/onboarding', requireAuth(), onboardingRouter);

const routesDir = path.join(__dirname, 'routes');
if (fs.existsSync(routesDir)) {
  fs.readdirSync(routesDir).forEach((file) => {
    if (file.endsWith('.ts') || file.endsWith('.js')) {
      const routeName = path.parse(file).name;
      const routePath = `./routes/${routeName}`;

      try {
        const routerModule = require(routePath);
        const router = routerModule.default || routerModule[Object.keys(routerModule)[0]];

        if (router && typeof router === 'function') {
          app.use(`/api/${routeName}`, requireAuth(), tenantResolver(), router);
          console.log(`📡 Mounted Route: /api/${routeName}`);
        }
      } catch (err: any) {
        console.error(`❌ Failed to mount ${routeName}:`, err.message);
      }
    }
  });
}

app.use(globalErrorHandler);

const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen(PORT, () => {
  console.log(`[tidelock-api] Listening on port ${PORT}`);
});

export { app };
