/**
 * platform/nocode-compiler — definition → file tree → optional sandbox preview.
 */
import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };
const logger = getLogger('nocode-compiler');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  target: z.enum(['react', 'vanilla']).default('react'),
});

export interface NocodeApp {
  id: string;
  tenantId: string;
  name: string;
  definition: Record<string, unknown>;
  fileTree: Record<string, string>;
  updatedAt: string;
}

const apps = new Map<string, NocodeApp>();

export function __resetNocodeCompilerStore(): void {
  apps.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('nocode-compiler', ConfigSchema);
}

export function compileDefinition(
  definition: Record<string, unknown>,
  target: 'react' | 'vanilla' = 'react',
): Record<string, string> {
  const title = String(definition.title || definition.name || 'App');
  if (target === 'vanilla') {
    return {
      'index.html': `<!doctype html><html><body><h1>${title}</h1><script src="app.js"></script></body></html>`,
      'app.js': `console.log(${JSON.stringify(title)});`,
    };
  }
  return {
    'App.tsx': `export default function App(){return <h1>${title}</h1>}`,
    'index.tsx': `import App from './App';\nconsole.log('mounted');`,
    'package.json': JSON.stringify({ name: 'nocode-app', private: true }, null, 2),
  };
}

export async function saveApp(
  tenantId: string,
  actorId: string,
  input: { name: string; definition: Record<string, unknown>; id?: string },
): Promise<NocodeApp> {
  return runCrudOperation({
    configName: 'nocode-compiler',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.name?.trim()) throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      const id = input.id || crypto.randomUUID();
      const fileTree = compileDefinition(input.definition || {}, config.target);
      const app: NocodeApp = {
        id,
        tenantId,
        name: input.name.trim(),
        definition: input.definition || {},
        fileTree,
        updatedAt: new Date().toISOString(),
      };
      apps.set(id, app);
      return app;
    },
    auditAction: 'data.created',
    auditResource: 'nocode_app',
    meterEventType: 'api_call',
  });
}

export async function compileApp(
  tenantId: string,
  actorId: string,
  appId: string,
): Promise<{ fileTree: Record<string, string> }> {
  return runCrudOperation({
    configName: 'nocode-compiler',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const app = apps.get(appId);
      if (!app || app.tenantId !== tenantId) {
        throw new AppError('App not found', ErrorCode.NOT_FOUND);
      }
      const config = await loadCfg();
      app.fileTree = compileDefinition(app.definition, config.target);
      app.updatedAt = new Date().toISOString();
      apps.set(appId, app);
      logger.info({ appId }, 'Nocode app compiled');
      return { fileTree: app.fileTree };
    },
    auditAction: 'data.updated',
    auditResource: 'nocode_app',
    meterEventType: 'api_call',
  });
}

export async function getApp(tenantId: string, appId: string): Promise<NocodeApp | null> {
  const a = apps.get(appId);
  if (!a || a.tenantId !== tenantId) return null;
  return a;
}
