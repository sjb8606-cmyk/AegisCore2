import fs from 'fs';
import path from 'path';
import { ZodSchema } from 'zod';
import { getLogger } from '@platform/observability';

const logger = getLogger('utils:config');
const configCache = new Map<string, unknown>();

export function loadConfig<T>(featureName: string, schema: ZodSchema<T>): T {
  if (configCache.has(featureName)) {
    return configCache.get(featureName) as T;
  }

  // Smart Root Resolution: Look for /config in the current dir or its parents
  let currentPath = process.cwd();
  let configDir = path.join(currentPath, 'config');

  while (!fs.existsSync(configDir) && currentPath !== path.parse(currentPath).root) {
    currentPath = path.dirname(currentPath);
    configDir = path.join(currentPath, 'config');
  }

  const filePath = path.join(configDir, `${featureName}.json`);

  if (!fs.existsSync(filePath)) {
    console.error(`\n❌ CONFIG NOT FOUND: ${featureName}.json at ${filePath}\n`);
    process.exit(1);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const validation = schema.safeParse(parsed);
  
  if (!validation.success) {
    console.error(`\n❌ INVALID CONFIG: ${featureName}.json`);
    process.exit(1);
  }

  configCache.set(featureName, validation.data);
  return validation.data as T;
}
