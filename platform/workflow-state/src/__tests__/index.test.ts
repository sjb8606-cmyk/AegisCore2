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
      maxHistory: 200,
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
  registerWorkflow,
  initEntity,
  transition,
  getEntityState,
  setHookFn,
  __resetWorkflowStateStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('workflow-state', () => {
  beforeEach(() => {
    __resetWorkflowStateStore();
    vi.clearAllMocks();
  });

  it('registers and transitions along allowed path', async () => {
    await registerWorkflow(tenantId, actorId, {
      entityType: 'job',
      states: ['logged', 'assigned', 'in_progress', 'shipped', 'closed'],
      initialState: 'logged',
      transitions: [
        { from: 'logged', to: 'assigned', hook: 'notify' },
        { from: 'assigned', to: 'in_progress' },
        { from: 'in_progress', to: 'shipped', hook: 'alert' },
        { from: 'shipped', to: 'closed' },
      ],
    });

    const hooks: string[] = [];
    setHookFn(async (_et, _id, from, to, hook) => {
      hooks.push(hook + ':' + from + '→' + to);
    });

    await initEntity(tenantId, actorId, {
      entityType: 'job',
      entityId: 'job-1',
    });
    await transition(tenantId, actorId, {
      entityType: 'job',
      entityId: 'job-1',
      newState: 'assigned',
    });
    await transition(tenantId, actorId, {
      entityType: 'job',
      entityId: 'job-1',
      newState: 'in_progress',
    });
    const es = await getEntityState(tenantId, 'job', 'job-1');
    expect(es?.currentState).toBe('in_progress');
    expect(hooks).toContain('notify:logged→assigned');
  });

  it('blocks illegal transition', async () => {
    await registerWorkflow(tenantId, actorId, {
      entityType: 'ticket',
      states: ['open', 'closed'],
      initialState: 'open',
      transitions: [{ from: 'open', to: 'closed' }],
    });
    await initEntity(tenantId, actorId, {
      entityType: 'ticket',
      entityId: 't1',
    });
    await expect(
      transition(tenantId, actorId, {
        entityType: 'ticket',
        entityId: 't1',
        newState: 'open',
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  it('rejects bad initial state', async () => {
    await expect(
      registerWorkflow(tenantId, actorId, {
        entityType: 'x',
        states: ['a', 'b'],
        initialState: 'c',
        transitions: [],
      }),
    ).rejects.toThrow(/initialState/i);
  });
});
