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
  __resetHvacEquipmentRegistryStore,
  flagRefrigerantComplianceIssue,
  getEquipmentHistory,
  registerEquipment
} from '../index';

describe('hvac-equipment-registry', () => {
  beforeEach(() => {
    __resetHvacEquipmentRegistryStore();
  });

  it('registers HVAC equipment', async () => {
    const equipment =
      await registerEquipment(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        {
          systemType: 'heat_pump',
          manufacturer: 'Example HVAC',
          modelNumber: 'HP-100',
          serialNumber: 'SN-100',
          installDate: new Date('2026-06-01'),
          refrigerantType: 'R-410A',
          warrantyExpiryDate:
            new Date('2031-06-01')
        }
      );

    expect(equipment.systemType)
      .toBe('heat_pump');

    expect(equipment.serialNumber)
      .toBe('SN-100');
  });

  it('rejects a duplicate serial number within the tenant', async () => {
    const tenantId = crypto.randomUUID();

    const data = {
      systemType: 'furnace' as const,
      manufacturer: 'Example HVAC',
      modelNumber: 'F-100',
      serialNumber: 'DUP-100',
      installDate: new Date('2026-05-01'),
      refrigerantType: 'R-32',
      warrantyExpiryDate: null
    };

    await registerEquipment(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      data
    );

    await expect(
      registerEquipment(
        tenantId,
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        data
      )
    ).rejects.toThrow();
  });

  it('keeps equipment history tenant-scoped', async () => {
    const tenantId = crypto.randomUUID();

    const equipment =
      await registerEquipment(
        tenantId,
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        {
          systemType: 'ac',
          manufacturer: 'Example HVAC',
          modelNumber: 'AC-100',
          serialNumber: 'AC-SN-100',
          installDate: new Date('2026-04-01'),
          refrigerantType: 'R-410A',
          warrantyExpiryDate: null
        }
      );

    await expect(
      getEquipmentHistory(
        crypto.randomUUID(),
        crypto.randomUUID(),
        equipment.equipmentId
      )
    ).rejects.toThrow();
  });
});
