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
      overrideTypes: ['price_override', 'no_sale', 'refund', 'void', 'discount'],
      requireReason: true,
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
  recordOverride,
  listOverrides,
  countOverridesByType,
  setPinVerifier,
  __resetManagerOverrideStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('manager-override-log', () => {
  beforeEach(() => {
    __resetManagerOverrideStore();
    vi.clearAllMocks();
    setPinVerifier(async (_t, pin) =>
      pin === '1234' ? { valid: true, managerId: 'mgr-1' } : { valid: false },
    );
  });

  it('records override with valid PIN', async () => {
    const row = await recordOverride(tenantId, actorId, {
      pin: '1234',
      cashierId: 'cashier-1',
      overrideType: 'price_override',
      reason: 'Loyalty price match',
      amountCents: 900,
      originalAmountCents: 1200,
      sessionId: 'sess-1',
    });
    expect(row.managerId).toBe('mgr-1');
    expect(row.overrideType).toBe('price_override');
  });

  it('rejects invalid PIN and missing reason', async () => {
    await expect(
      recordOverride(tenantId, actorId, {
        pin: '0000',
        cashierId: 'c1',
        overrideType: 'void',
        reason: 'mistake',
      }),
    ).rejects.toThrow(/invalid manager pin/i);
    await expect(
      recordOverride(tenantId, actorId, {
        pin: '1234',
        cashierId: 'c1',
        overrideType: 'void',
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('lists and counts overrides', async () => {
    await recordOverride(tenantId, actorId, {
      pin: '1234',
      cashierId: 'c1',
      overrideType: 'no_sale',
      reason: 'drawer check',
    });
    await recordOverride(tenantId, actorId, {
      pin: '1234',
      cashierId: 'c1',
      overrideType: 'refund',
      reason: 'customer return',
      amountCents: 500,
    });
    const list = await listOverrides(tenantId, actorId, {
      managerId: 'mgr-1',
    });
    expect(list).toHaveLength(2);
    const counts = await countOverridesByType(
      tenantId,
      actorId,
      new Date(Date.now() - 60_000).toISOString(),
    );
    expect(counts.no_sale).toBe(1);
    expect(counts.refund).toBe(1);
  });
});
