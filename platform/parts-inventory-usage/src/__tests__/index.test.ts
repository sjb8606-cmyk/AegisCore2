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

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn()

  };
});

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
  __resetPartsInventoryUsageStore,
  __setStockLevel,
  getStockLevel,
  logPartUsage,
  triggerReorder
} from '../index';

describe('parts-inventory-usage', () => {
  beforeEach(() => {
    __resetPartsInventoryUsageStore();
  });

  it('logs usage and reduces tenant-scoped stock', async () => {
    const tenantId = crypto.randomUUID();

    __setStockLevel({
      tenantId,
      partSku: 'FILTER-001',
      location: 'van_stock',
      quantity: 10,
      reorderPoint: 3
    });

    const usage = await logPartUsage(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      'FILTER-001',
      2,
      'van_stock',
      18.5
    );

    expect(usage.quantityUsed).toBe(2);

    const remaining = await getStockLevel(
      tenantId,
      crypto.randomUUID(),
      'FILTER-001',
      'van_stock'
    );

    expect(remaining).toBe(8);
  });

  it('rejects usage exceeding available stock', async () => {
    const tenantId = crypto.randomUUID();

    __setStockLevel({
      tenantId,
      partSku: 'PUMP-001',
      location: 'warehouse',
      quantity: 2,
      reorderPoint: 1
    });

    await expect(
      logPartUsage(
        tenantId,
        crypto.randomUUID(),
        crypto.randomUUID(),
        'PUMP-001',
        3,
        'warehouse',
        100
      )
    ).rejects.toThrow();
  });

  it('triggers reorder at the configured stock threshold', async () => {
    const tenantId = crypto.randomUUID();

    __setStockLevel({
      tenantId,
      partSku: 'VALVE-001',
      location: 'van_stock',
      quantity: 2,
      reorderPoint: 3
    });

    const shouldReorder =
      await triggerReorder(
        tenantId,
        crypto.randomUUID(),
        'VALVE-001',
        'van_stock'
      );

    expect(shouldReorder).toBe(true);
  });
});
