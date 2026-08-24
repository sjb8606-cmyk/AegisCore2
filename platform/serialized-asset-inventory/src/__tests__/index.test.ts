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
  __resetSerializedAssetInventoryStore,
  registerAsset,
  updateCondition,
  getAvailableAssets
} from '../index';

describe('serialized-asset-inventory', () => {
  beforeEach(() => {
    __resetSerializedAssetInventoryStore();
  });

  it('registers a serialized asset as available', async () => {
    const asset = await registerAsset(
      crypto.randomUUID(),
      crypto.randomUUID(),
      'EX-100',
      'SER-001',
      '2026-01-15T00:00:00.000Z',
      'Warehouse A'
    );

    expect(asset.currentStatus).toBe('available');
    expect(asset.serialNumber).toBe('SER-001');
  });

  it('rejects a duplicate serial number within the tenant', async () => {
    const tenantId = crypto.randomUUID();

    await registerAsset(
      tenantId,
      crypto.randomUUID(),
      'EX-100',
      'SER-001',
      '2026-01-15T00:00:00.000Z',
      'Warehouse A'
    );

    await expect(
      registerAsset(
        tenantId,
        crypto.randomUUID(),
        'EX-100',
        'SER-001',
        '2026-01-15T00:00:00.000Z',
        'Warehouse B'
      )
    ).rejects.toThrow();
  });

  it('updates condition and preserves tenant isolation', async () => {
    const tenantId = crypto.randomUUID();
    const asset = await registerAsset(
      tenantId,
      crypto.randomUUID(),
      'EX-200',
      'SER-002',
      '2026-02-01T00:00:00.000Z',
      'Yard'
    );

    const updated = await updateCondition(
      tenantId,
      crypto.randomUUID(),
      asset.assetId,
      'needs_repair',
      'Engine inspection required'
    );

    expect(updated.condition).toBe('needs_repair');

    const available = await getAvailableAssets(
      tenantId,
      crypto.randomUUID(),
      'EX-200',
      '2026-03-01T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z'
    );

    expect(available).toHaveLength(1);
    expect(available[0].assetId).toBe(asset.assetId);
  });
});
