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
  __resetDisposalDumpFeeTrackingStore,
  flagHazardousHandlingRequired,
  getDisposalCostTotal,
  logDisposal
} from '../index';

describe('disposal-dump-fee-tracking', () => {
  beforeEach(() => {
    __resetDisposalDumpFeeTrackingStore();
  });

  it('logs disposal and calculates total job cost', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    await logDisposal(
      tenantId,
      actorId,
      jobId,
      'Moncton Transfer Station',
      'general',
      42.50,
      3
    );

    await logDisposal(
      tenantId,
      actorId,
      jobId,
      'Moncton Transfer Station',
      'recyclable',
      17.50,
      2
    );

    expect(
      await getDisposalCostTotal(
        tenantId,
        actorId,
        jobId
      )
    ).toBe(60);
  });

  it('flags hazardous waste for special handling', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    expect(
      await flagHazardousHandlingRequired(
        tenantId,
        actorId,
        'hazardous'
      )
    ).toBe(true);

    expect(
      await flagHazardousHandlingRequired(
        tenantId,
        actorId,
        'general'
      )
    ).toBe(false);
  });

  it('rejects negative disposal fees', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    await expect(
      logDisposal(
        tenantId,
        actorId,
        jobId,
        'Transfer Station',
        'general',
        -10,
        2
      )
    ).rejects.toThrow();
  });
});
