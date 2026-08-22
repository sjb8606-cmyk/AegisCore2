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
      defaultStatus: 'draft',
      jobTypes: [
        {
          type: 'service',
          requiredFields: ['description'],
          allowedTransitions: [
            { from: 'draft', to: 'open' },
            { from: 'open', to: 'assigned' },
            { from: 'assigned', to: 'in_progress' },
            { from: 'in_progress', to: 'completed' },
            { from: 'open', to: 'cancelled' },
            { from: 'assigned', to: 'cancelled' },
            { from: 'draft', to: 'cancelled' },
          ],
        },
      ],
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
  createJob,
  assignJob,
  scheduleJob,
  transitionJob,
  listJobs,
  __resetJobWorkOrderStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('job-work-order', () => {
  beforeEach(() => {
    __resetJobWorkOrderStore();
    vi.clearAllMocks();
  });

  it('creates, opens, assigns, schedules, completes', async () => {
    const job = await createJob(tenantId, actorId, {
      type: 'service',
      description: 'Annual boiler inspection',
      entityRef: 'equip-1',
    });
    expect(job.status).toBe('draft');

    await transitionJob(tenantId, actorId, job.id, 'open');
    const assigned = await assignJob(tenantId, actorId, job.id, 'tech-42');
    expect(assigned.status).toBe('assigned');
    expect(assigned.assignedTo).toBe('tech-42');

    await scheduleJob(
      tenantId,
      actorId,
      job.id,
      '2026-09-01T14:00:00Z',
    );
    await transitionJob(tenantId, actorId, job.id, 'in_progress');
    const done = await transitionJob(tenantId, actorId, job.id, 'completed');
    expect(done.status).toBe('completed');
  });

  it('blocks illegal transition', async () => {
    const job = await createJob(tenantId, actorId, {
      type: 'service',
      description: 'Fix leak',
    });
    await expect(
      transitionJob(tenantId, actorId, job.id, 'completed'),
    ).rejects.toThrow(/not allowed/i);
  });

  it('lists by assignee', async () => {
    const j = await createJob(tenantId, actorId, {
      type: 'service',
      description: 'x',
    });
    await transitionJob(tenantId, actorId, j.id, 'open');
    await assignJob(tenantId, actorId, j.id, 'tech-9');
    const list = await listJobs(tenantId, { assignedTo: 'tech-9' });
    expect(list).toHaveLength(1);
  });
});
