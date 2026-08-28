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
      maxVarianceCentsWithoutNote: 100,
      varianceReasonCodes: ['count_error', 'theft', 'change_error', 'other'],
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
  openDrawer,
  recordCashSale,
  recordCashRefund,
  recordPaidOut,
  closeDrawer,
  __resetCashDrawerStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('cash-drawer-reconciliation', () => {
  beforeEach(() => {
    __resetCashDrawerStore();
    vi.clearAllMocks();
  });

  it('reconciles to zero variance', async () => {
    const s = await openDrawer(tenantId, actorId, {
      registerId: 'reg-1',
      openingFloatCents: 20000,
    });
    await recordCashSale(tenantId, actorId, s.id, 5000);
    await recordCashRefund(tenantId, actorId, s.id, 1000);
    await recordPaidOut(tenantId, actorId, s.id, 500);
    // expected = 20000 + 5000 - 1000 - 500 = 23500
    const closed = await closeDrawer(tenantId, actorId, s.id, {
      countedCents: 23500,
    });
    expect(closed.expectedCents).toBe(23500);
    expect(closed.varianceCents).toBe(0);
    expect(closed.status).toBe('closed');
  });

  it('requires reason for large variance', async () => {
    const s = await openDrawer(tenantId, actorId, {
      registerId: 'reg-2',
      openingFloatCents: 10000,
    });
    await expect(
      closeDrawer(tenantId, actorId, s.id, { countedCents: 9000 }),
    ).rejects.toThrow(/varianceReason/i);
    const closed = await closeDrawer(tenantId, actorId, s.id, {
      countedCents: 9000,
      varianceReason: 'count_error',
    });
    expect(closed.varianceCents).toBe(-1000);
  });

  it('blocks second open on same register', async () => {
    await openDrawer(tenantId, actorId, {
      registerId: 'reg-3',
      openingFloatCents: 5000,
    });
    await expect(
      openDrawer(tenantId, actorId, {
        registerId: 'reg-3',
        openingFloatCents: 5000,
      }),
    ).rejects.toThrow(/already has an open/i);
  });
});
