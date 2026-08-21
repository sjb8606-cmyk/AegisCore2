import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/metering', () => ({ recordUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({ enabled: true, target: 'react' }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { saveApp, compileApp, compileDefinition, __resetNocodeCompilerStore } from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('nocode-compiler', () => {
  beforeEach(() => {
    __resetNocodeCompilerStore();
    vi.clearAllMocks();
  });

  it('compiles react tree', () => {
    const tree = compileDefinition({ title: 'Hello' }, 'react');
    expect(tree['App.tsx']).toContain('Hello');
  });

  it('saves and recompiles app', async () => {
    const app = await saveApp(tenantId, actorId, {
      name: 'Demo',
      definition: { title: 'Demo' },
    });
    const compiled = await compileApp(tenantId, actorId, app.id);
    expect(Object.keys(compiled.fileTree).length).toBeGreaterThan(0);
  });

  it('rejects empty name', async () => {
    await expect(
      saveApp(tenantId, actorId, { name: '', definition: {} }),
    ).rejects.toThrow(/name/i);
  });
});
