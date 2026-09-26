import 'dotenv/config';
import express from 'express';
import path from 'path';
import { requireAuth } from '../../../platform/auth/src/index';
import { tenantResolver } from '../../../platform/tenancy/src/index';
import { globalErrorHandler } from '../../../platform/utils/src/index';
import { mountApp } from '../../../platform/app-loader/src/index';

const app=express();
app.use(express.json());
const report=mountApp(app,{appId:'business-architect',routesDir:path.join(__dirname,'routes'),requireAuth,tenantResolver});
console.log('[business-architect] mounted',report.mounted,'missing',report.missingRouteFile,'unlisted',report.unlistedInConfig);
app.use(globalErrorHandler);
const PORT=parseInt(process.env.BUSINESS_ARCHITECT_PORT||'3050',10);
if(require.main===module)app.listen(PORT,()=>console.log('[business-architect] Listening on '+PORT));
export { app };
