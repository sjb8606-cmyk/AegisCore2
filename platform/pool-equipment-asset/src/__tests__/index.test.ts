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
  __resetPoolEquipmentAssetStore,
  createPoolEquipmentAsset,
  flagReplacementNeeded,
  getUpcomingServiceDue,
  logService
} from '../index';

describe('pool-equipment-asset', () => {
  beforeEach(() => {
    __resetPoolEquipmentAssetStore();
  });

  it('creates an equipment asset and records service', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const siteId = crypto.randomUUID();
    const visitId = crypto.randomUUID();

    const equipment =
      await createPoolEquipmentAsset(
        tenantId,
        actorId,
        clientId,
        siteId,
        'pump',
        new Date('2026-05-01')
      );

    const updated = await logService(
      tenantId,
      actorId,
      equipment.equipmentId,
      visitId,
      'Pump serviced'
    );

    expect(updated.equipmentId)
      .toBe(equipment.equipmentId);
    expect(updated.lastServicedDate)
      .not.toBeNull();
  });

  it('rejects invalid equipment types', async () => {
    await expect(
      createPoolEquipmentAsset(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        'invalid' as any,
        new Date('2026-05-01')
      )
    ).rejects.toThrow();
  });

  it('returns upcoming service assets and supports replacement flags', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const siteId = crypto.randomUUID();

    const equipment =
      await createPoolEquipmentAsset(
        tenantId,
        actorId,
        clientId,
        siteId,
        'filter',
        new Date('2026-01-01')
      );

    equipment.nextServiceDue =
      new Date('2026-09-01');

    const flag =
      await flagReplacementNeeded(
        tenantId,
        actorId,
        equipment.equipmentId,
        'Filter housing is cracked'
      );

    const upcoming =
      await getUpcomingServiceDue(
        tenantId,
        actorId,
        30
      );

    expect(flag.equipmentId)
      .toBe(equipment.equipmentId);

    expect(upcoming).toHaveLength(1);
  });
});
