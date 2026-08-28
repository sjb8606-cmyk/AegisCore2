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
      maxReprintsPerTransaction: 3,
      maxReprintsPerSession: 50,
      alertOnLimit: true,
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
  recordReprint,
  getTransactionReprints,
  getHighReprintTransactions,
  __resetReceiptReprintStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const transactionId = 'txn-1';

describe('receipt-reprint-audit', () => {
  beforeEach(() => {
    __resetReceiptReprintStore();
    vi.clearAllMocks();
  });

  it('records reprints with incrementing numbers', async () => {
    const r1 = await recordReprint(tenantId, actorId, {
      transactionId,
      cashierId: 'c1',
      sessionId: 's1',
    });
    const r2 = await recordReprint(tenantId, actorId, {
      transactionId,
      cashierId: 'c1',
      sessionId: 's1',
    });
    expect(r1.reprintNumber).toBe(1);
    expect(r2.reprintNumber).toBe(2);
    const list = await getTransactionReprints(tenantId, actorId, transactionId);
    expect(list).toHaveLength(2);
  });

  it('blocks over max reprints per transaction', async () => {
    for (let i = 0; i < 3; i++) {
      await recordReprint(tenantId, actorId, {
        transactionId,
        cashierId: 'c1',
      });
    }
    await expect(
      recordReprint(tenantId, actorId, {
        transactionId,
        cashierId: 'c1',
      }),
    ).rejects.toThrow(/max reprints/i);
  });

  it('flags high-reprint transactions', async () => {
    await recordReprint(tenantId, actorId, {
      transactionId: 'txn-a',
      cashierId: 'c1',
    });
    await recordReprint(tenantId, actorId, {
      transactionId: 'txn-a',
      cashierId: 'c1',
    });
    await recordReprint(tenantId, actorId, {
      transactionId: 'txn-b',
      cashierId: 'c1',
    });
    const high = await getHighReprintTransactions(tenantId, actorId, 2);
    expect(high).toHaveLength(1);
    expect(high[0].transactionId).toBe('txn-a');
    expect(high[0].count).toBe(2);
  });
});
