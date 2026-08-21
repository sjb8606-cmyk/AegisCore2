import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      persistAcrossSessions: true,
      maxStepsStored: 200,
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
  upsertGoal,
  appendStep,
  getAgentMemory,
  setGoalStatus,
  __resetAgentMemoryStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const runId = 'run-mem-1';

describe('agent-memory', () => {
  beforeEach(() => {
    __resetAgentMemoryStore();
    vi.clearAllMocks();
  });

  it('stores goal and steps for resume', async () => {
    await upsertGoal(tenantId, actorId, {
      runId,
      goalText: 'Finish CSR report',
    });
    await appendStep(tenantId, actorId, {
      runId,
      stepNumber: 1,
      decision: { text: 'search data' },
      result: { ok: true },
    });
    await appendStep(tenantId, actorId, {
      runId,
      stepNumber: 2,
      decision: { text: 'draft' },
      result: { draft: true },
    });
    const mem = await getAgentMemory(tenantId, runId);
    expect(mem.goal?.goalText).toBe('Finish CSR report');
    expect(mem.steps).toHaveLength(2);
  });

  it('updates goal status', async () => {
    await upsertGoal(tenantId, actorId, {
      runId,
      goalText: 'Ship',
    });
    const g = await setGoalStatus(tenantId, actorId, runId, 'completed');
    expect(g.status).toBe('completed');
  });

  it('rejects missing goalText', async () => {
    try {
      await upsertGoal(tenantId, actorId, { runId, goalText: '' });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/required/i);
    }
  });
});
