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
      defaultHysteresis: 2,
      maxOpenPerTenant: 500,
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
  createRule,
  evaluate,
  listOpen,
  crossesThreshold,
  isCleared,
  __resetThresholdAlertStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('threshold-alert', () => {
  beforeEach(() => {
    __resetThresholdAlertStore();
    vi.clearAllMocks();
  });

  it('crossesThreshold operators', () => {
    expect(crossesThreshold(11, 'gt', 10)).toBe(true);
    expect(crossesThreshold(10, 'gt', 10)).toBe(false);
    expect(crossesThreshold(5, 'lt', 10)).toBe(true);
  });

  it('fires on low stock then resolves with hysteresis', async () => {
    await createRule(tenantId, actorId, {
      entityType: 'sku',
      metric: 'qty',
      operator: 'lt',
      threshold: 10,
      hysteresis: 2,
      action: 'notify',
    });

    const first = await evaluate(tenantId, actorId, {
      entityType: 'sku',
      entityId: 'sku-1',
      metric: 'qty',
      value: 5,
    });
    expect(first.fired).toHaveLength(1);
    expect((await listOpen(tenantId)).length).toBe(1);

    // still inside band — no resolve
    const mid = await evaluate(tenantId, actorId, {
      entityType: 'sku',
      entityId: 'sku-1',
      metric: 'qty',
      value: 11,
    });
    expect(mid.resolved).toHaveLength(0);

    // fully cleared (>= threshold + hysteresis)
    const done = await evaluate(tenantId, actorId, {
      entityType: 'sku',
      entityId: 'sku-1',
      metric: 'qty',
      value: 13,
    });
    expect(done.resolved).toHaveLength(1);
    expect((await listOpen(tenantId)).length).toBe(0);
  });

  it('isCleared respects hysteresis', () => {
    expect(isCleared(11, 'lt', 10, 2)).toBe(false);
    expect(isCleared(12, 'lt', 10, 2)).toBe(true);
  });
});
