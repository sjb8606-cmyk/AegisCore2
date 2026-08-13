/**
 * platform/app-loader/src/index.ts
 *
 * The config-driven app assembly layer AegisCore2 was always meant to have.
 * mountApp() reads config/apps/<appId>.json and mounts ONLY the cores that
 * config declares, reporting any drift between config and the routes/
 * folder instead of silently mounting or silently ignoring it.
 */

import path from 'path';
import fs from 'fs';
import type { Express, RequestHandler } from 'express';
import { getLogger } from '@platform/observability';
import { loadAppConfig, listDeclaredApps, AppError, ErrorCode } from './config';
import type { AppConfig } from './config';

export { loadAppConfig, listDeclaredApps, AppConfig, AppError, ErrorCode };

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
      logger.info(`[app-loader:${appId}] mounted /api/${core}`);
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
