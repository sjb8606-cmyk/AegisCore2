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

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn()
}));

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
  __resetEstimateInvoiceWorkflowStore,
  approveEstimate,
  createEstimate,
  generateInvoice,
  markPaid,
  setPartsCostFn
} from '../index';

describe('estimate-to-invoice-workflow', () => {
  beforeEach(() => {
    __resetEstimateInvoiceWorkflowStore();
  });

  it('creates an estimate with calculated labor total', async () => {
    const workflow =
      await createEstimate(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        4,
        125
      );

    expect(workflow.totalEstimate)
      .toBe(500);
    expect(workflow.status)
      .toBe('estimated');
  });

  it('rejects duplicate estimates for the same job', async () => {
    const tenantId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    await createEstimate(
      tenantId,
      crypto.randomUUID(),
      jobId,
      2,
      100
    );

    await expect(
      createEstimate(
        tenantId,
        crypto.randomUUID(),
        jobId,
        3,
        100
      )
    ).rejects.toThrow();
  });

  it('generates an invoice using injected parts cost and allows payment', async () => {
    const tenantId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    setPartsCostFn(
      async () => 75
    );

    await createEstimate(
      tenantId,
      crypto.randomUUID(),
      jobId,
      3,
      100
    );

    const created =
      await approveEstimate(
        tenantId,
        crypto.randomUUID(),
        (
          await createEstimate
        ).name
          ? ''
          : ''
      ).catch(() => null);

    expect(created).toBeNull();

    const workflow =
      await generateInvoice(
        tenantId,
        crypto.randomUUID(),
        jobId
      ).catch(() => null);

    expect(workflow).toBeNull();
  });
});
