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
      tenderTypes: ['cash', 'card', 'gift', 'comp', 'other'],
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
  recordTender,
  getSessionTenderMix,
  getShiftTenderMix,
  __resetTenderMixStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const sessionId = 'session-1';
const shiftId = 'shift-1';

describe('tender-mix-reporting', () => {
  beforeEach(() => {
    __resetTenderMixStore();
    vi.clearAllMocks();
  });

  it('aggregates session tender mix', async () => {
    await recordTender(tenantId, actorId, {
      sessionId,
      shiftId,
      tenderType: 'cash',
      amountCents: 5000,
    });
    await recordTender(tenantId, actorId, {
      sessionId,
      shiftId,
      tenderType: 'card',
      amountCents: 12000,
    });
    await recordTender(tenantId, actorId, {
      sessionId,
      shiftId,
      tenderType: 'cash',
      amountCents: 1000,
      direction: 'refund',
    });
    const mix = await getSessionTenderMix(tenantId, actorId, sessionId);
    expect(mix.byType.cash.netCents).toBe(4000);
    expect(mix.byType.card.salesCents).toBe(12000);
    expect(mix.netCents).toBe(16000);
  });

  it('aggregates by shift', async () => {
    await recordTender(tenantId, actorId, {
      sessionId: 's-a',
      shiftId,
      tenderType: 'gift',
      amountCents: 3000,
    });
    await recordTender(tenantId, actorId, {
      sessionId: 's-b',
      shiftId,
      tenderType: 'comp',
      amountCents: 500,
    });
    const mix = await getShiftTenderMix(tenantId, actorId, shiftId);
    expect(mix.byType.gift.salesCents).toBe(3000);
    expect(mix.byType.comp.salesCents).toBe(500);
  });

  it('rejects invalid tender type', async () => {
    await expect(
      recordTender(tenantId, actorId, {
        sessionId,
        tenderType: 'bitcoin',
        amountCents: 100,
      }),
    ).rejects.toThrow(/tenderType/i);
  });
});
