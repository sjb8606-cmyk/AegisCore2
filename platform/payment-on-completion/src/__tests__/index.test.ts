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
  __resetPaymentOnCompletionStore,
  chargeCardOnFile,
  collectDeposit,
  createPayment,
  getPaymentStatus
} from '../index';

describe('payment-on-completion', () => {
  beforeEach(() => {
    __resetPaymentOnCompletionStore();
  });

  it('creates a pending payment and charges it on completion', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    const payment = await createPayment(
      tenantId,
      actorId,
      jobId,
      250,
      'card_on_file'
    );

    expect(payment.status).toBe('pending');

    const charged = await chargeCardOnFile(
      tenantId,
      actorId,
      jobId,
      250
    );

    expect(charged.status).toBe('paid');
  });

  it('records a partial deposit', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    const payment = await createPayment(
      tenantId,
      actorId,
      jobId,
      400
    );

    const updated = await collectDeposit(
      tenantId,
      actorId,
      jobId,
      100
    );

    expect(updated.paymentId).toBe(
      payment.paymentId
    );
    expect(updated.depositAmount).toBe(100);
    expect(
      await getPaymentStatus(
        tenantId,
        actorId,
        jobId
      )
    ).toBe('partial');
  });

  it('rejects a payment amount greater than the job amount', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    await createPayment(
      tenantId,
      actorId,
      jobId,
      100
    );

    await expect(
      chargeCardOnFile(
        tenantId,
        actorId,
        jobId,
        150
      )
    ).rejects.toThrow();
  });
});
