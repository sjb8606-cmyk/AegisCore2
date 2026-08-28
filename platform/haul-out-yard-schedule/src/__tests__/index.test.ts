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
      defaultSlotMinutes: 120,
      maxYardBlocks: 50,
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
  registerYardBlock,
  scheduleHaulJob,
  completeHaulJob,
  cancelHaulJob,
  listLiftSchedule,
  __resetHaulOutYardStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('haul-out-yard-schedule', () => {
  beforeEach(() => {
    __resetHaulOutYardStore();
    vi.clearAllMocks();
  });

  it('schedules haul_out with yard block', async () => {
    const block = await registerYardBlock(tenantId, actorId, { label: 'A1' });
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const job = await scheduleHaulJob(tenantId, actorId, {
      vesselId: 'v1',
      jobType: 'haul_out',
      liftStart: start,
      yardBlockId: block.id,
    });
    expect(job.status).toBe('scheduled');
    expect(job.yardBlockId).toBe(block.id);
  });

  it('rejects lift slot conflicts', async () => {
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 2 * 86_400_000 + 2 * 3_600_000).toISOString();
    await scheduleHaulJob(tenantId, actorId, {
      vesselId: 'v1',
      jobType: 'splash',
      liftStart: start,
      liftEnd: end,
    });
    await expect(
      scheduleHaulJob(tenantId, actorId, {
        vesselId: 'v2',
        jobType: 'splash',
        liftStart: start,
        liftEnd: end,
      }),
    ).rejects.toThrow(/conflict/i);
  });

  it('completes and cancels jobs', async () => {
    const block = await registerYardBlock(tenantId, actorId, { label: 'B2' });
    const job = await scheduleHaulJob(tenantId, actorId, {
      vesselId: 'v3',
      jobType: 'haul_out',
      liftStart: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      yardBlockId: block.id,
    });
    const done = await completeHaulJob(tenantId, actorId, job.id, true);
    expect(done.status).toBe('completed');

    const job2 = await scheduleHaulJob(tenantId, actorId, {
      vesselId: 'v4',
      jobType: 'splash',
      liftStart: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    });
    const cancelled = await cancelHaulJob(tenantId, actorId, job2.id);
    expect(cancelled.status).toBe('cancelled');
    const schedule = await listLiftSchedule(
      tenantId,
      actorId,
      new Date().toISOString(),
      new Date(Date.now() + 10 * 86_400_000).toISOString(),
    );
    expect(schedule.some((j) => j.id === job.id)).toBe(true);
  });
});
