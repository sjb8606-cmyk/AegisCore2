/**
 * platform/app-loader/src/config.ts
 *
 * Reads and validates config/apps/<appId>.json — the JSON files that are
 * supposed to declare which feature cores an assembled app is made of.
 * Until this file existed, nothing in the repo actually read these files;
 * apps/tidelock-api mounted whatever happened to be in its own local
 * routes/ folder, regardless of what config/apps/tidelock.json said.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };

// ── Schema ──────────────────────────────────────────────────────

const RouteDeclSchema = z.object({
  path: z.string(),
  method: z.string(),
  auth: z.boolean().default(true),
});

export const AppConfigSchema = z.object({
  app_id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  tenant_id: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'draft']).default('active'),
  cores: z.array(z.string().min(1)).min(1),
  config: z.record(z.any()).default({}),
  api_keys_required: z.array(z.string()).default([]),
  routes: z.array(RouteDeclSchema).default([]),
  created_at: z.string().optional(),
  owner: z.string().optional(),
  pilot_contact: z.string().optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

function findAppsConfigDir(startDir: string = process.cwd()): string {
  let currentPath = startDir;
  let appsDir = path.join(currentPath, 'config', 'apps');

  while (!fs.existsSync(appsDir) && currentPath !== path.parse(currentPath).root) {
    currentPath = path.dirname(currentPath);
    appsDir = path.join(currentPath, 'config', 'apps');
  }

  return appsDir;
}

export function loadAppConfig(appId: string, startDir?: string): AppConfig {
  const appsDir = findAppsConfigDir(startDir);
  const filePath = path.join(appsDir, `${appId}.json`);

  if (!fs.existsSync(filePath)) {
    throw new AppError(
      `App config not found: ${appId}.json (looked in ${appsDir})`,
      ErrorCode.NOT_FOUND,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    throw new AppError(
      `App config at ${filePath} is not valid JSON`,
      ErrorCode.UNPROCESSABLE,
      err instanceof Error ? err.message : String(err),
    );
  }

  const result = AppConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(
      `App config ${appId}.json failed schema validation`,
      ErrorCode.UNPROCESSABLE,
      result.error.errors,
    );
  }

  if (result.data.app_id !== appId) {
    throw new AppError(
      `App config file ${appId}.json declares app_id "${result.data.app_id}", which doesn't match its filename`,
      ErrorCode.UNPROCESSABLE,
    );
  }

  return result.data;
}

export function listDeclaredApps(startDir?: string): string[] {
  const appsDir = findAppsConfigDir(startDir);
  if (!fs.existsSync(appsDir)) return [];
  return fs
    .readdirSync(appsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.parse(f).name);
}
