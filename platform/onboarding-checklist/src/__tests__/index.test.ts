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
      blockUntilRequiredComplete: true,
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
  createTemplate,
  startOnboarding,
  completeTask,
  assertOnboardingComplete,
  __resetOnboardingChecklistStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const employeeId = 'emp-1';

describe('onboarding-checklist', () => {
  beforeEach(() => {
    __resetOnboardingChecklistStore();
    vi.clearAllMocks();
  });

  it('starts run from template and blocks until required done', async () => {
    const tpl = await createTemplate(tenantId, actorId, {
      roleKey: 'cashier',
      name: 'Cashier onboarding',
      tasks: [
        { key: 'i9', label: 'I-9', required: true, dueDaysFromStart: 1 },
        { key: 'tour', label: 'Tour', required: false, dueDaysFromStart: 3 },
      ],
    });
    const run = await startOnboarding(tenantId, actorId, {
      employeeId,
      templateId: tpl.id,
    });
    expect(run.tasks).toHaveLength(2);
    await expect(assertOnboardingComplete(tenantId, employeeId)).rejects.toThrow(
      /incomplete/i,
    );
  });

  it('completes when required tasks done', async () => {
    const tpl = await createTemplate(tenantId, actorId, {
      roleKey: 'tech',
      name: 'Tech',
      tasks: [
        { key: 'laptop', label: 'Laptop', required: true, dueDaysFromStart: 1 },
      ],
    });
    const run = await startOnboarding(tenantId, actorId, {
      employeeId,
      templateId: tpl.id,
    });
    const done = await completeTask(tenantId, actorId, run.id, 'laptop');
    expect(done.status).toBe('completed');
    const gate = await assertOnboardingComplete(tenantId, employeeId);
    expect(gate.complete).toBe(true);
  });

  it('rejects unknown task key', async () => {
    const tpl = await createTemplate(tenantId, actorId, {
      roleKey: 'x',
      name: 'X',
      tasks: [{ key: 'a', label: 'A', required: true, dueDaysFromStart: 1 }],
    });
    const run = await startOnboarding(tenantId, actorId, {
      employeeId,
      templateId: tpl.id,
    });
    await expect(
      completeTask(tenantId, actorId, run.id, 'nope'),
    ).rejects.toThrow(/task not found/i);
  });
});
