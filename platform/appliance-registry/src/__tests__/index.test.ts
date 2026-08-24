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
  __resetApplianceRegistryStore,
  registerAppliance,
  getApplianceHistory,
  checkWarrantyStatus
} from '../index';

describe('appliance-registry', () => {
  beforeEach(() => {
    __resetApplianceRegistryStore();
  });

  it('registers and retrieves an appliance', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const clientId = crypto.randomUUID();

    const appliance = await registerAppliance(
      tenantId,
      actorId,
      clientId,
      {
        applianceType: 'refrigerator',
        manufacturer: 'Example',
        modelNumber: 'RF-100',
        serialNumber: 'SN-123',
        purchaseDate: '2025-01-01',
        warrantyExpiryDate: '2027-01-01'
      }
    );

    const result = await getApplianceHistory(
      tenantId,
      actorId,
      appliance.applianceId
    );

    expect(result.clientId).toBe(clientId);
    expect(result.serialNumber).toBe('SN-123');
  });

  it('rejects an invalid appliance record', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const clientId = crypto.randomUUID();

    await expect(
      registerAppliance(
        tenantId,
        actorId,
        clientId,
        {
          applianceType: 'refrigerator',
          manufacturer: '',
          modelNumber: 'RF-100',
          serialNumber: 'SN-123'
        }
      )
    ).rejects.toThrow();
  });

  it('enforces tenant isolation', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const clientId = crypto.randomUUID();

    const appliance = await registerAppliance(
      tenantId,
      actorId,
      clientId,
      {
        applianceType: 'washer',
        manufacturer: 'Example',
        modelNumber: 'W-200',
        serialNumber: 'SN-456',
        warrantyExpiryDate: '2027-01-01'
      }
    );

    await expect(
      getApplianceHistory(
        crypto.randomUUID(),
        actorId,
        appliance.applianceId
      )
    ).rejects.toThrow();
  });
});
