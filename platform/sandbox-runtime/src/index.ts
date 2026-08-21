/**
 * platform/sandbox-runtime
 */
import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };
const logger = getLogger('sandbox-runtime');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  isolation: z.enum(['firecracker', 'gvisor', 'container']).default('container'),
  limits: z
    .object({
      sessionTtlMinutes: z.number().default(60),
      cpuMillicores: z.number().default(500),
      memoryMb: z.number().default(512),
      diskMb: z.number().default(1024),
      maxConcurrentSessionsPerTenant: z.number().default(5),
      networkEgress: z.enum(['none', 'allowlist', 'open']).default('none'),
    })
    .default({
      sessionTtlMinutes: 60,
      cpuMillicores: 500,
      memoryMb: 512,
      diskMb: 1024,
      maxConcurrentSessionsPerTenant: 5,
      networkEgress: 'none',
    }),
  previewDomain: z.string().default('preview.local'),
});

export type SessionStatus = 'provisioning' | 'running' | 'stopped' | 'expired';

export interface SandboxSession {
  id: string;
  tenantId: string;
  status: SessionStatus;
  previewUrl: string | null;
  runtimeContainerId: string | null;
  files: Record<string, string>;
  createdAt: string;
  expiresAt: string;
}

export interface BuildLog {
  id: string;
  sessionId: string;
  chunk: string;
  stream: 'stdout' | 'stderr';
  createdAt: string;
}

const sessions = new Map<string, SandboxSession>();
const logs = new Map<string, BuildLog[]>();

export function __resetSandboxRuntimeStore(): void {
  sessions.clear();
  logs.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('sandbox-runtime', ConfigSchema);
}

export async function createSession(
  tenantId: string,
  actorId: string,
  input?: { ttlMinutes?: number },
): Promise<SandboxSession> {
  return runCrudOperation({
    configName: 'sandbox-runtime',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const limits = config.limits || {
        sessionTtlMinutes: 60,
        maxConcurrentSessionsPerTenant: 5,
      };
      const active = [...sessions.values()].filter(
        (s) =>
          s.tenantId === tenantId &&
          (s.status === 'running' || s.status === 'provisioning'),
      );
      if (active.length >= (limits.maxConcurrentSessionsPerTenant || 5)) {
        throw new AppError('Session limit reached', ErrorCode.FORBIDDEN);
      }
      const ttl = input?.ttlMinutes ?? limits.sessionTtlMinutes ?? 60;
      const id = crypto.randomUUID();
      const domain = config.previewDomain || 'preview.local';
      const now = Date.now();
      const session: SandboxSession = {
        id,
        tenantId,
        status: 'running',
        previewUrl: 'https://' + id.slice(0, 8) + '.' + domain,
        runtimeContainerId: 'mock-ctr-' + id.slice(0, 8),
        files: {},
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttl * 60_000).toISOString(),
      };
      sessions.set(id, session);
      logs.set(id, []);
      logger.info({ sessionId: id }, 'Sandbox session created');
      return session;
    },
    auditAction: 'data.created',
    auditResource: 'sandbox_session',
    meterEventType: 'api_call',
  });
}

export async function writeFile(
  tenantId: string,
  actorId: string,
  sessionId: string,
  path: string,
  content: string,
): Promise<{ path: string }> {
  return runCrudOperation({
    configName: 'sandbox-runtime',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const s = sessions.get(sessionId);
      if (!s || s.tenantId !== tenantId) {
        throw new AppError('Session not found', ErrorCode.NOT_FOUND);
      }
      if (s.status !== 'running') {
        throw new AppError('Session not running', ErrorCode.CONFLICT);
      }
      s.files[path] = content;
      sessions.set(sessionId, s);
      return { path };
    },
    auditAction: 'data.updated',
    auditResource: 'sandbox_session',
    meterEventType: 'api_call',
  });
}

export async function buildSession(
  tenantId: string,
  actorId: string,
  sessionId: string,
): Promise<{ ok: boolean; logs: BuildLog[] }> {
  return runCrudOperation({
    configName: 'sandbox-runtime',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const s = sessions.get(sessionId);
      if (!s || s.tenantId !== tenantId) {
        throw new AppError('Session not found', ErrorCode.NOT_FOUND);
      }
      const entry: BuildLog = {
        id: crypto.randomUUID(),
        sessionId,
        chunk: `mock build ok (${Object.keys(s.files).length} files)`,
        stream: 'stdout',
        createdAt: new Date().toISOString(),
      };
      const list = logs.get(sessionId) || [];
      list.push(entry);
      logs.set(sessionId, list);
      return { ok: true, logs: list };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'sandbox_build',
    meterEventType: 'api_call',
  });
}

export async function execInSession(
  tenantId: string,
  actorId: string,
  sessionId: string,
  command: string,
): Promise<{ stdout: string; exitCode: number }> {
  return runCrudOperation({
    configName: 'sandbox-runtime',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const s = sessions.get(sessionId);
      if (!s || s.tenantId !== tenantId) {
        throw new AppError('Session not found', ErrorCode.NOT_FOUND);
      }
      return {
        stdout: `mock exec: ${String(command).slice(0, 120)}`,
        exitCode: 0,
      };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'sandbox_exec',
    meterEventType: 'api_call',
  });
}

export async function getSession(
  tenantId: string,
  sessionId: string,
): Promise<SandboxSession | null> {
  const s = sessions.get(sessionId);
  if (!s || s.tenantId !== tenantId) return null;
  return s;
}

export async function stopSession(
  tenantId: string,
  actorId: string,
  sessionId: string,
): Promise<SandboxSession> {
  return runCrudOperation({
    configName: 'sandbox-runtime',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const s = sessions.get(sessionId);
      if (!s || s.tenantId !== tenantId) {
        throw new AppError('Session not found', ErrorCode.NOT_FOUND);
      }
      s.status = 'stopped';
      sessions.set(sessionId, s);
      return s;
    },
    auditAction: 'data.updated',
    auditResource: 'sandbox_session',
    meterEventType: 'api_call',
  });
}
