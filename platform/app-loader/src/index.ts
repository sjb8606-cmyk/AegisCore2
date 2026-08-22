import path from 'path';
import fs from 'fs';
import { Router } from 'express';
import type { Express, RequestHandler } from 'express';
import { getLogger } from '@platform/observability';
import { loadAppConfig, listDeclaredApps, AppError, ErrorCode } from './config';
import type { AppConfig } from './config';
import { resolveAppIdForTenant, clearAppIdCache } from './tenant-router';

export { loadAppConfig, listDeclaredApps, AppConfig, AppError, ErrorCode };
export { resolveAppIdForTenant, clearAppIdCache };

const logger = getLogger('app-loader');

export interface MountAppOptions {
  appId: string;
  routesDir: string;
  requireAuth: () => RequestHandler;
  tenantResolver: () => RequestHandler;
  configStartDir?: string;
}

export interface MountReport {
  appId: string;
  mounted: string[];
  missingRouteFile: string[];
  unlistedInConfig: string[];
}

function discoverRouteFiles(routesDir: string): string[] {
  if (!fs.existsSync(routesDir)) return [];
  return fs
    .readdirSync(routesDir)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'))
    .map((f) => path.parse(f).name);
}

export function mountApp(app: Express, options: MountAppOptions): MountReport {
  const { appId, routesDir, requireAuth, tenantResolver, configStartDir } = options;

  const config: AppConfig = loadAppConfig(appId, configStartDir);
  const availableRouteFiles = new Set(discoverRouteFiles(routesDir));
  const declaredCores = new Set(config.cores);

  const report: MountReport = { appId, mounted: [], missingRouteFile: [], unlistedInConfig: [] };

  for (const core of config.cores) {
    if (!availableRouteFiles.has(core)) {
      report.missingRouteFile.push(core);
      logger.warn(`[app-loader:${appId}] core "${core}" is declared in config but has no routes/${core}.ts — not mounted`);
      continue;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const routeModule = require(path.join(routesDir, core));
      const router = routeModule.default || routeModule[Object.keys(routeModule)[0]];

      if (!router || typeof router !== 'function') {
        report.missingRouteFile.push(core);
        logger.warn(`[app-loader:${appId}] routes/${core} did not export a valid router — not mounted`);
        continue;
      }

      app.use(`/api/${core}`, requireAuth(), tenantResolver(), router);
      report.mounted.push(core);
      logger.debug(`[app-loader:${appId}] mounted /api/${core}`);
    } catch (err) {
      report.missingRouteFile.push(core);
      logger.warn(`[app-loader:${appId}] failed to load routes/${core}: ${err instanceof Error ? err.message : err}`);
    }
  }

  for (const file of availableRouteFiles) {
    if (!declaredCores.has(file)) {
      report.unlistedInConfig.push(file);
      logger.warn(`[app-loader:${appId}] routes/${file}.ts exists but "${file}" is not listed in config/apps/${appId}.json — skipped`);
    }
  }

  if (report.missingRouteFile.length > 0 || report.unlistedInConfig.length > 0) {
    logger.warn(`[app-loader:${appId}] config/route drift detected — missingRouteFile=${JSON.stringify(report.missingRouteFile)} unlistedInConfig=${JSON.stringify(report.unlistedInConfig)}`);
  }

  return report;
}

export function checkAppConfig(appId: string, routesDir: string, configStartDir?: string): MountReport {
  const config = loadAppConfig(appId, configStartDir);
  const availableRouteFiles = new Set(discoverRouteFiles(routesDir));
  const declaredCores = new Set(config.cores);

  const report: MountReport = { appId, mounted: [], missingRouteFile: [], unlistedInConfig: [] };

  for (const core of config.cores) {
    if (availableRouteFiles.has(core)) {
      report.mounted.push(core);
    } else {
      report.missingRouteFile.push(core);
    }
  }
  for (const file of availableRouteFiles) {
    if (!declaredCores.has(file)) report.unlistedInConfig.push(file);
  }

  return report;
}

// ── buildAppRouter() — the single-server dynamic-dispatch piece ────────

export interface BuiltAppRouter {
  router: Router;
  report: MountReport;
}

export interface BuildAppRouterOptions {
  appId: string;
  routesDir: string;
  configStartDir?: string;
  platformRoot?: string;
}

function findPlatformDir(startDir: string): string {
  let currentPath = startDir;
  let dir = path.join(currentPath, 'platform');
  while (!fs.existsSync(dir) && currentPath !== path.parse(currentPath).root) {
    currentPath = path.dirname(currentPath);
    dir = path.join(currentPath, 'platform');
  }
  return dir;
}

function resolveRouteModulePath(core: string, routesDir: string, platformRoot: string): string | null {
  const localBase = path.join(routesDir, core);
  if (fs.existsSync(localBase + '.ts') || fs.existsSync(localBase + '.js')) return localBase;

  const sharedBase = path.join(platformRoot, core, 'route');
  if (fs.existsSync(sharedBase + '.ts') || fs.existsSync(sharedBase + '.js')) return sharedBase;

  return null;
}

export function buildAppRouter(options: BuildAppRouterOptions): BuiltAppRouter {
  const { appId, routesDir, configStartDir } = options;
  const platformRoot = options.platformRoot || findPlatformDir(routesDir);

  const config: AppConfig = loadAppConfig(appId, configStartDir);
  const router = Router();
  const report: MountReport = { appId, mounted: [], missingRouteFile: [], unlistedInConfig: [] };

  for (const core of config.cores) {
    const modulePath = resolveRouteModulePath(core, routesDir, platformRoot);
    if (!modulePath) {
      report.missingRouteFile.push(core);
      logger.warn(`[app-loader:${appId}] core "${core}" has no route file in ${routesDir} or shared ${platformRoot}/${core}/route.ts — not mounted`);
      continue;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const routeModule = require(modulePath);
      const coreRouter = routeModule.default || routeModule[Object.keys(routeModule)[0]];

      if (!coreRouter || typeof coreRouter !== 'function') {
        report.missingRouteFile.push(core);
        logger.warn(`[app-loader:${appId}] ${modulePath} did not export a valid router — not mounted`);
        continue;
      }

      router.use(`/${core}`, coreRouter);
      report.mounted.push(core);
      // debug, not info — a 180+ core app would otherwise flood boot logs
      // with one line per core; the per-app summary below is what matters.
      logger.debug(`[app-loader:${appId}] built /${core} into shared app router`);
    } catch (err) {
      report.missingRouteFile.push(core);
      logger.warn(`[app-loader:${appId}] failed to load ${modulePath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const availableLocalFiles = discoverRouteFiles(routesDir);
  const declaredCores = new Set(config.cores);
  for (const file of availableLocalFiles) {
    if (!declaredCores.has(file)) report.unlistedInConfig.push(file);
  }

  if (report.missingRouteFile.length > 0 || report.unlistedInConfig.length > 0) {
    logger.warn(`[app-loader:${appId}] config/route drift detected — missingRouteFile=${JSON.stringify(report.missingRouteFile)} unlistedInConfig=${JSON.stringify(report.unlistedInConfig)}`);
  }

  return { router, report };
}
