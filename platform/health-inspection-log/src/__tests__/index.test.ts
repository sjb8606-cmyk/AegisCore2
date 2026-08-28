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
      coldMaxC: 4,
      hotMinC: 60,
      sanitizerPpmMin: 50,
      sanitizerPpmMax: 200,
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
  logReading,
  addCorrectiveAction,
  listOutOfRange,
  getShiftHealthSummary,
  __resetHealthInspectionLogStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('health-inspection-log', () => {
  beforeEach(() => {
    __resetHealthInspectionLogStore();
    vi.clearAllMocks();
  });

  it('flags cold hold above max as out of range', async () => {
    const entry = await logReading(tenantId, actorId, {
      kind: 'cold_hold',
      locationLabel: 'Walk-in',
      value: 7,
    });
    expect(entry.inRange).toBe(false);
    const open = await listOutOfRange(tenantId, actorId);
    expect(open).toHaveLength(1);
  });

  it('accepts sanitizer in range and hot hold at threshold', async () => {
    const san = await logReading(tenantId, actorId, {
      kind: 'sanitizer',
      locationLabel: 'Dish station',
      value: 100,
    });
    expect(san.inRange).toBe(true);
    const hot = await logReading(tenantId, actorId, {
      kind: 'hot_hold',
      locationLabel: 'Soup well',
      value: 60,
    });
    expect(hot.inRange).toBe(true);
  });

  it('records corrective action and shift summary', async () => {
    const entry = await logReading(tenantId, actorId, {
      kind: 'cold_hold',
      locationLabel: 'Prep cooler',
      value: 8,
    });
    await addCorrectiveAction(
      tenantId,
      actorId,
      entry.id,
      'Moved product; service call placed',
    );
    const open = await listOutOfRange(tenantId, actorId, true);
    expect(open).toHaveLength(0);
    const summary = await getShiftHealthSummary(
      tenantId,
      actorId,
      new Date(Date.now() - 3600_000).toISOString(),
    );
    expect(summary.total).toBe(1);
    expect(summary.outOfRange).toBe(1);
    expect(summary.uncorrected).toBe(0);
  });
});
