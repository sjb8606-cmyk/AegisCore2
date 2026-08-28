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
      defaultRestockingFeeBps: 1000,
      returnWindowDays: 30,
      reasonCodes: [
        'damaged',
        'wrong_item',
        'not_as_described',
        'changed_mind',
        'other',
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
  requestRma,
  approveRma,
  markReceived,
  completeRefund,
  rejectRma,
  __resetRmaStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const orderId = '00000000-0000-4000-8000-0000000000ee';

describe('return-merchandise-auth', () => {
  beforeEach(() => {
    __resetRmaStore();
    vi.clearAllMocks();
  });

  it('runs full RMA happy path with restocking fee', async () => {
    const rma = await requestRma(tenantId, actorId, {
      orderId,
      reasonCode: 'damaged',
      lines: [{ sku: 'SKU-1', quantity: 1, unitPriceCents: 10000 }],
    });
    expect(rma.status).toBe('requested');
    await approveRma(tenantId, actorId, rma.id);
    await markReceived(tenantId, actorId, rma.id);
    const refunded = await completeRefund(tenantId, actorId, rma.id);
    // 10% restocking fee on 10000 = 1000 → refund 9000
    expect(refunded.status).toBe('refunded');
    expect(refunded.refundCents).toBe(9000);
  });

  it('rejects refund before receive', async () => {
    const rma = await requestRma(tenantId, actorId, {
      orderId,
      reasonCode: 'wrong_item',
      lines: [{ sku: 'SKU-2', quantity: 1, unitPriceCents: 500 }],
    });
    await approveRma(tenantId, actorId, rma.id);
    await expect(completeRefund(tenantId, actorId, rma.id)).rejects.toThrow(
      /received/i,
    );
  });

  it('can reject a requested RMA', async () => {
    const rma = await requestRma(tenantId, actorId, {
      orderId,
      reasonCode: 'changed_mind',
      lines: [{ sku: 'SKU-3', quantity: 2, unitPriceCents: 100 }],
    });
    const rejected = await rejectRma(tenantId, actorId, rma.id, 'Outside window');
    expect(rejected.status).toBe('rejected');
  });
});
