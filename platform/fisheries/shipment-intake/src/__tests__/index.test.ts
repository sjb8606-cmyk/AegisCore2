import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../utils/src/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/src/index')>();
  return { ...actual, loadConfig: vi.fn() };
});
vi.mock('../../../species-registry/src/index', () => ({
  SpeciesRegistryService: { getSpecies: vi.fn() },
}));

import { ShipmentIntakeService, ErrorCode } from '../index';
import { withTenantQuery } from '../../../../tenancy/src/index';
import { loadConfig } from '../../../../utils/src/index';
import { SpeciesRegistryService } from '../../../species-registry/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SPECIES_ID = '33333333-3333-3333-3333-333333333333';
const SHIPMENT_ID = '44444444-4444-4444-4444-444444444444';

const baseInput = {
  speciesId: SPECIES_ID,
  vesselName: 'F/V Northern Tide',
  catchDate: '2026-07-15T08:00:00.000Z',
  qualityGrade: 'premium' as const,
  catchZone: 'NAFO-4X',
};

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, limits: { shipmentListPageSize: 100 } });
  (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
    id: SPECIES_ID, common_name: 'Atlantic Salmon', is_active: true,
  });
});

describe('ShipmentIntakeService.logShipment — unit handling', () => {
  it('defaults to kg and stores weight_kg unchanged, original_unit "kg"', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: SHIPMENT_ID, weight_kg: 500 }]);

    await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, { ...baseInput, weight: 500 });

    const insertCall = (withTenantQuery as any).mock.calls[0];
    expect(insertCall[1]).toEqual(expect.arrayContaining([500, 500, 'kg']));
  });

  it('converts pounds to kg exactly, using the real conversion factor, and preserves the original pounds value', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: SHIPMENT_ID }]);

    await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, {
      ...baseInput, weight: 1200, weightUnit: 'lb',
    });

    const insertCall = (withTenantQuery as any).mock.calls[0];
    const params = insertCall[1];
    expect(params).toContain(544.31);
    expect(params).toContain(1200);
    expect(params).toContain('lb');
  });

  it('does not touch weight_kg math for a kg-entered shipment — canonical value equals input exactly', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: SHIPMENT_ID }]);

    await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, {
      ...baseInput, weight: 850.5, weightUnit: 'kg',
    });

    const insertCall = (withTenantQuery as any).mock.calls[0];
    expect(insertCall[1]).toContain(850.5);
  });
});

describe('ShipmentIntakeService.logShipment', () => {
  it('propagates NOT_FOUND when the species does not genuinely exist', async () => {
    (SpeciesRegistryService.getSpecies as any).mockRejectedValue(
      Object.assign(new Error('not found'), { code: ErrorCode.NOT_FOUND })
    );

    await expect(
      ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, { ...baseInput, weight: 500 })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('throws FORBIDDEN when the species is inactive', async () => {
    (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
      id: SPECIES_ID, common_name: 'Atlantic Salmon', is_active: false,
    });

    await expect(
      ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, { ...baseInput, weight: 500 })
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('throws BAD_REQUEST for an invalid userId', async () => {
    await expect(
      ShipmentIntakeService.logShipment(TENANT_ID, 'not-a-uuid', { ...baseInput, weight: 500 })
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });
});

describe('ShipmentIntakeService.getShipment', () => {
  it('throws NOT_FOUND for a nonexistent shipment', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      ShipmentIntakeService.getShipment(TENANT_ID, SHIPMENT_ID)
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('ShipmentIntakeService.listShipments', () => {
  it('applies speciesId and date range filters to the real query', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await ShipmentIntakeService.listShipments(TENANT_ID, {
      speciesId: SPECIES_ID,
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
    });

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('species_id = $2');
    expect(call[1]).toEqual([TENANT_ID, SPECIES_ID, '2026-07-01', '2026-07-31']);
  });
});

describe('ShipmentIntakeService.getTotalWeightForSpecies', () => {
  it('returns the real summed weight (always canonical kg, regardless of original units)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ total_weight_kg: '1701.00' }]);

    const total = await ShipmentIntakeService.getTotalWeightForSpecies(TENANT_ID, SPECIES_ID);
    expect(total).toBe(1701);
  });

  it('returns 0 when there are no matching shipments', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ total_weight_kg: '0' }]);

    const total = await ShipmentIntakeService.getTotalWeightForSpecies(TENANT_ID, SPECIES_ID);
    expect(total).toBe(0);
  });
});
