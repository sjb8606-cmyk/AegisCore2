import '../../../platform/observability/src/tracing';
import express from 'express';
import fs from 'fs';
import path from 'path';
const { json } = require('body-parser');
import { requireAuth } from '../../../platform/auth/src/index';
import { tenantResolver } from '../../../platform/tenancy/src/index';
import { observabilityMiddleware } from '../../../platform/observability/src/index';
import { globalErrorHandler } from '../../../platform/utils/src/index';

const app = express();
app.use(json());
app.use(observabilityMiddleware());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// =============================================================
// ⚡ THE AUTO-DISCOVERY ENGINE (v3.6.3)
// Scans the routes folder and automatically mounts every feature
// =============================================================
const routesDir = path.join(__dirname, 'routes');
if (fs.existsSync(routesDir)) {
  fs.readdirSync(routesDir).forEach((file) => {
    if (file.endsWith('.ts') || file.endsWith('.js')) {
      const routeName = path.parse(file).name;
      const routePath = `./routes/${routeName}`;
      
      try {
        const routerModule = require(routePath);
        // Supports both "export default" and "export { router }"
        const router = routerModule.default || routerModule[Object.keys(routerModule)[0]];
        
        if (router && typeof router === 'function') {
          app.use(`/api/${routeName}`, requireAuth(), tenantResolver(), router);
          console.log(`📡 [AUTO-DISCOVERY] Mounted Route: /api/${routeName}`);
        }
      } catch (err: any) {
        console.error(`❌ [AUTO-DISCOVERY] Failed to mount ${routeName}:`, err.message);
      }
    }
  });
}

app.use(globalErrorHandler);

app.listen(3000, () => {
  console.log('[example-api] Listening on port 3000 (development)');
});
