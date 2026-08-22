import type { Request, Response, NextFunction, Router } from 'express';
import { requireAuth } from '../../auth/src/index';
import { tenantResolver } from '../../tenancy/src/index';
import { resolveAppIdForTenant } from './tenant-router';
import { listDeclaredApps, buildAppRouter, MountReport } from './index';
import { getLogger } from '../../observability/src/index';

const logger = getLogger('app-loader:dispatch');

export interface DynamicDispatchOptions {
  appRoutesDirs: Record<string, string>;
  configStartDir?: string;
  appIds?: string[];
}

export interface DynamicDispatchResult {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  reports: Record<string, MountReport>;
}

export function createDynamicDispatch(options: DynamicDispatchOptions): DynamicDispatchResult {
  const { appRoutesDirs, configStartDir } = options;
  const appIds = options.appIds ?? listDeclaredApps(configStartDir);

  const routers = new Map<string, Router>();
  const reports: Record<string, MountReport> = {};

  for (const appId of appIds) {
    const routesDir = appRoutesDirs[appId];
    if (!routesDir) {
      logger.warn(`[dispatch] no routesDir configured for declared app "${appId}" — skipped, its tenants will get a clean 503`);
      continue;
    }
    // One app's bad config must not take the whole gateway down with it —
    // every other declared app's tenants should keep working. Caught this
    // the hard way: golden-key.json had a genuinely invalid tenant_id
    // (not a hex UUID) and, before this try/catch existed, that single
    // bad file crashed the entire process at boot, including tidelock.
    try {
      const { router, report } = buildAppRouter({ appId, routesDir, configStartDir });
      routers.set(appId, router);
      reports[appId] = report;
      logger.info(`[dispatch] built router for "${appId}": mounted=${report.mounted.length} missing=${report.missingRouteFile.length} unlisted=${report.unlistedInConfig.length}`);
    } catch (err) {
      logger.error(`[dispatch] failed to build router for declared app "${appId}" — skipped, its tenants will get a clean 503 instead of taking down the gateway. ${err instanceof Error ? err.message : err}`);
    }
  }

  const auth = requireAuth();
  const tenant = tenantResolver();

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    auth(req, res, (authErr?: unknown) => {
      if (authErr) return next(authErr);
      tenant(req, res, async (tenantErr?: unknown) => {
        if (tenantErr) return next(tenantErr);
        try {
          const tenantId = (req as any).auth?.tenantId;
          const appId = await resolveAppIdForTenant(tenantId);
          const router = routers.get(appId);
          if (!router) {
            logger.warn(`[dispatch] tenant ${tenantId} resolved to app "${appId}", but no router is built for it on this gateway`);
            return res.status(503).json({
              error: 'SERVICE_UNAVAILABLE',
              message: `App "${appId}" is not currently being served by this gateway.`,
            });
          }
          router(req, res, next);
        } catch (err) {
          next(err);
        }
      });
    });
  };

  return { middleware, reports };
}
