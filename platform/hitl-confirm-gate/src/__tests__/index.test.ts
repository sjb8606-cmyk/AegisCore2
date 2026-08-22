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
      gatedActions: ['publish', 'payment'],
      defaultPrompts: ['Looks correct?', 'Ready to proceed?'],
      allowedConfirmRoles: ['admin', 'reviewer', 'operator'],
      ttlMinutes: 60,
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
  openGate,
  respondGate,
  assertConfirmed,
  listPending,
  requiresGate,
  __resetHitlConfirmGateStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('hitl-confirm-gate', () => {
  beforeEach(() => {
    __resetHitlConfirmGateStore();
    vi.clearAllMocks();
  });

  it('requiresGate respects config list', () => {
    expect(requiresGate('publish', ['publish', 'payment'])).toBe(true);
    expect(requiresGate('read', ['publish'])).toBe(false);
    expect(requiresGate('x', ['*'])).toBe(true);
  });

  it('opens gate, confirms all prompts, assert passes', async () => {
    const gate = await openGate(tenantId, actorId, {
      actionId: 'act-1',
      actionType: 'publish',
      payload: { docId: 'd1' },
    });
    expect(gate.status).toBe('pending');
    expect(gate.prompts.length).toBe(2);
    expect((await listPending(tenantId)).length).toBe(1);

    const closed = await respondGate(tenantId, actorId, gate.id, {
      role: 'reviewer',
      responses: gate.prompts.map((p) => ({ promptId: p.id, value: true })),
    });
    expect(closed.status).toBe('confirmed');

    const confirmed = await assertConfirmed(tenantId, 'act-1');
    expect(confirmed.id).toBe(gate.id);
  });

  it('rejects when a required prompt is false', async () => {
    const gate = await openGate(tenantId, actorId, {
      actionId: 'act-2',
      actionType: 'payment',
    });
    const closed = await respondGate(tenantId, actorId, gate.id, {
      role: 'admin',
      responses: [
        { promptId: gate.prompts[0].id, value: true },
        { promptId: gate.prompts[1].id, value: false },
      ],
    });
    expect(closed.status).toBe('rejected');
    await expect(assertConfirmed(tenantId, 'act-2')).rejects.toThrow(
      /not confirmed/i,
    );
  });
});
