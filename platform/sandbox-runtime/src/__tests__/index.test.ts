import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/metering', () => ({ recordUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      isolation: 'container',
      limits: {
        sessionTtlMinutes: 60,
        cpuMillicores: 500,
        memoryMb: 512,
        diskMb: 1024,
        maxConcurrentSessionsPerTenant: 5,
        networkEgress: 'none',
      },
      previewDomain: 'preview.local',
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  createSession,
  writeFile,
  buildSession,
  execInSession,
  stopSession,
  __resetSandboxRuntimeStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('sandbox-runtime', () => {
  beforeEach(() => {
    __resetSandboxRuntimeStore();
    vi.clearAllMocks();
  });

  it('creates session with preview url', async () => {
    const s = await createSession(tenantId, actorId);
    expect(s.status).toBe('running');
    expect(s.previewUrl).toBeTruthy();
    expect(String(s.previewUrl)).toContain('preview');
  });

  it('writes file and builds', async () => {
    const s = await createSession(tenantId, actorId);
    await writeFile(tenantId, actorId, s.id, 'index.html', '<h1>hi</h1>');
    const build = await buildSession(tenantId, actorId, s.id);
    expect(build.ok).toBe(true);
    expect(build.logs.length).toBeGreaterThan(0);
  });

  it('executes command', async () => {
    const s = await createSession(tenantId, actorId);
    const r = await execInSession(tenantId, actorId, s.id, 'node -v');
    expect(r.exitCode).toBe(0);
  });

  it('stops session', async () => {
    const s = await createSession(tenantId, actorId);
    const stopped = await stopSession(tenantId, actorId, s.id);
    expect(stopped.status).toBe('stopped');
  });
});
