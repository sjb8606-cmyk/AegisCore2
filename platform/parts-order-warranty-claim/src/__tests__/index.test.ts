import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  __resetPartsOrderWarrantyClaimStore,
  orderPart,
  fileWarrantyClaim,
  updateOrderStatus
} from '../index';

describe('parts-order-warranty-claim', () => {
  beforeEach(() => {
    __resetPartsOrderWarrantyClaimStore();
  });

  it('orders a part and files a warranty claim', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const diagnosisId = crypto.randomUUID();

    const order = await orderPart(
      tenantId,
      actorId,
      diagnosisId,
      'PART-100',
      'Replacement valve',
      85
    );

    expect(order.orderStatus).toBe('ordered');
    expect(order.coveredByWarranty).toBe(false);

    const claimed = await fileWarrantyClaim(
      tenantId,
      actorId,
      order.orderId
    );

    expect(claimed.coveredByWarranty).toBe(true);
    expect(claimed.warrantyClaimId).toBeTruthy();
  });

  it('rejects a negative part cost', async () => {
    await expect(
      orderPart(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        'PART-200',
        'Compressor',
        -1
      )
    ).rejects.toThrow();
  });

  it('enforces tenant isolation when updating an order', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const order = await orderPart(
      tenantId,
      actorId,
      crypto.randomUUID(),
      'PART-300',
      'Control board',
      150
    );

    await expect(
      updateOrderStatus(
        crypto.randomUUID(),
        actorId,
        order.orderId,
        'received'
      )
    ).rejects.toThrow();
  });
});
