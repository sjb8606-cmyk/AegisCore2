import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn()
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn()
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn()

  };
});

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', async () => {
  const actual = await vi.importActual<any>(
    '@platform/crud-kernel'
  );

  return {
    ...actual,
    runCrudOperation: async (options: any) =>
      options.action()
  };
});

import {
  __resetSingleVisitJobRecordStore,
  completeJob,
  getJobHistory,
  startJob
} from '../index';

describe('single-visit-job-record', () => {
  beforeEach(() => {
    __resetSingleVisitJobRecordStore();
  });

  it('starts and completes a single visit job', async () => {
    const tenantId = crypto.randomUUID();
    const clientId = crypto.randomUUID();

    const job = await startJob(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      clientId
    );

    const completed = await completeJob(
      tenantId,
      crypto.randomUUID(),
      job.jobId,
      'Removed debris and cleaned work area.',
      [
        {
          type: 'before',
          url: 'https://example.com/before.jpg'
        },
        {
          type: 'after',
          url: 'https://example.com/after.jpg'
        }
      ],
      true
    );

    expect(completed.completionTimestamp)
      .not.toBeNull();
    expect(completed.photos).toHaveLength(2);
    expect(completed.customerSignatureCaptured)
      .toBe(true);
  });

  it('rejects completing the same job twice', async () => {
    const tenantId = crypto.randomUUID();

    const job = await startJob(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID()
    );

    await completeJob(
      tenantId,
      crypto.randomUUID(),
      job.jobId,
      'Complete'
    );

    await expect(
      completeJob(
        tenantId,
        crypto.randomUUID(),
        job.jobId,
        'Again'
      )
    ).rejects.toThrow();
  });

  it('returns only jobs belonging to the requested tenant and client', async () => {
    const tenantId = crypto.randomUUID();
    const clientId = crypto.randomUUID();

    await startJob(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      clientId
    );

    await startJob(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID()
    );

    await startJob(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      clientId
    );

    const history = await getJobHistory(
      tenantId,
      crypto.randomUUID(),
      clientId
    );

    expect(history).toHaveLength(1);
    expect(history[0].clientId).toBe(clientId);
  });
});
