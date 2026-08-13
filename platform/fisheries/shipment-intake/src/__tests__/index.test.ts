import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = { query: vi.fn() };

vi.mock('../../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
  withTenant: vi.fn(async (_tenantId: string, fn: (client: any) => Promise<any>) => fn(mockClient)),
}));
vi.mock('../../../../utils/src/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/src/index')>();
  return { ...actual, loadConfig: vi.fn() };
});
vi.mock('../../../species-registry/src/index', () => ({
  SpeciesRegistryService: { getSpecies: vi.fn() },
}));
vi.mock('../../../../lot-traceability/src/index', () => ({
  createLotWithClient: vi.fn(),
}));

import { ShipmentIntakeService, ErrorCode } from '../index';
import { withTenantQuery } from '../../../../tenancy/src/index';
import { loadConfig } from '../../../../utils/src/index';
import { SpeciesRegistryService } from '../../../species-registry/src/index';
import { createLotWithClient } from '../../../../lot-traceability/src/index';

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
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValue({ rows: [] });

  (loadConfig as any).mockReturnValue({ enabled: true, limits: { shipmentListPageSize: 100 } });
  (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
    id: SPECIES_ID, common_name: 'Atlantic Salmon', is_active: true,
  });
  (createLotWithClient as any).mockResolvedValue({ id: 'lot-placeholder', lot_code: 'LOT-PLACEHOLDER' });
});

describe('ShipmentIntakeService.logShipment — unit handling', () => {
  it('defaults to kg and stores weight_kg unchanged, original_unit "kg"', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: SHIPMENT_ID, weight_kg: 500 }] });
    await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, { ...baseInput, weight: 500 });
    const insertCall = mockClient.query.mock.calls[0];
    expect(insertCall[1]).toEqual(expect.arrayContaining([500, 500, 'kg']));
  });

  it('converts pounds to kg exactly, using the real conversion factor, and preserves the original pounds value', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: SHIPMENT_ID }] });
    await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, { ...baseInput, weight: 1200, weightUnit: 'lb' });
    const params = mockClient.query.mock.calls[0][1];
    expect(params).toContain(544.31);
    expect(params).toContain(1200);
    expect(params).toContain('lb');
  });
});

describe('ShipmentIntakeService.logShipment — condition code and round weight', () => {
  it('defaults conditionCode to "whole" and leaves round_weight_kg NULL when no factor is given', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: SHIPMENT_ID }] });
    await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, { ...baseInput, weight: 500 });
    const params = mockClient.query.mock.calls[0][1];
    expect(params).toContain('whole');
    expect(params[8]).toBeNull();
  });

  it('computes a real round weight ONLY when a caller-supplied conversion factor is given', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: SHIPMENT_ID }] });
    await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, {
      ...baseInput, weight: 1000, conditionCode: 'dressed', conversionFactor: 1.33,
    });
    const params = mockClient.query.mock.calls[0][1];
    expect(params).toContain('dressed');
    expect(params).toContain(1330);
    expect(params).toContain(1.33);
  });

  it('never fabricates a conversion factor when the caller does not supply one, even for a non-whole condition code', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: SHIPMENT_ID }] });
    await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, {
      ...baseInput, weight: 1000, conditionCode: 'headed_gutted',
    });
    const params = mockClient.query.mock.calls[0][1];
    expect(params).toContain('headed_gutted');
    expect(params[8]).toBeNull();
    expect(params[9]).toBeNull();
  });
});

describe('ShipmentIntakeService.logShipment — lot creation (new)', () => {
  it('creates a lot atomically alongside the shipment, sourced from the shipment itself', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: SHIPMENT_ID, weight_kg: 500 }] });

    await ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, { ...baseInput, weight: 500 });

    expect(createLotWithClient).toHaveBeenCalledWith(
      mockClient,
      TENANT_ID,
      USER_ID,
      expect.objectContaining({
        sourceType: 'shipment',
        sourceRefTable: 'fisheries_shipments',
        sourceRefId: SHIPMENT_ID,
        quantity: 500,
        unit: 'kg',
      }),
    );
  });

  it('propagates a lot-creation failure as a logShipment failure (same transaction, no orphaned shipment)', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: SHIPMENT_ID, weight_kg: 500 }] });
    (createLotWithClient as any).mockRejectedValueOnce(new Error('lot insert failed'));

    await expect(
      ShipmentIntakeService.logShipment(TENANT_ID, USER_ID, { ...baseInput, weight: 500 }),
    ).rejects.toThrow('lot insert failed');
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
      speciesId: SPECIES_ID, fromDate: '2026-07-01', toDate: '2026-07-31',
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
