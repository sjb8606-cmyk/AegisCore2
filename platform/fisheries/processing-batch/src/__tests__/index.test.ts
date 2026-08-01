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
vi.mock('../../../shipment-intake/src/index', () => ({
  ShipmentIntakeService: { getShipment: vi.fn() },
}));

import { ProcessingBatchService, ErrorCode } from '../index';
import { withTenantQuery } from '../../../../tenancy/src/index';
import { loadConfig } from '../../../../utils/src/index';
import { SpeciesRegistryService } from '../../../species-registry/src/index';
import { ShipmentIntakeService } from '../../../shipment-intake/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SPECIES_ID = '33333333-3333-3333-3333-333333333333';
const SHIPMENT_1 = '44444444-4444-4444-4444-444444444444';
const SHIPMENT_2 = '55555555-5555-5555-5555-555555555555';
const BATCH_ID = '66666666-6666-6666-6666-666666666666';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, limits: { batchListPageSize: 100 } });
  (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
    id: SPECIES_ID, common_name: 'Atlantic Salmon', is_active: true,
  });
});

describe('ProcessingBatchService.createBatch', () => {
  const validInput = {
    speciesId: SPECIES_ID,
    shipmentIds: [SHIPMENT_1, SHIPMENT_2],
    startedAt: '2026-07-15T09:00:00.000Z',
  };

  it('sums real shipment weights and creates a real batch with linked shipments', async () => {
    (ShipmentIntakeService.getShipment as any)
      .mockResolvedValueOnce({ id: SHIPMENT_1, species_id: SPECIES_ID, weight_kg: 500 })
      .mockResolvedValueOnce({ id: SHIPMENT_2, species_id: SPECIES_ID, weight_kg: 300 });

    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: BATCH_ID, raw_input_weight_kg: 800 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await ProcessingBatchService.createBatch(TENANT_ID, USER_ID, validInput);

    expect(result.raw_input_weight_kg).toBe(800);
    const insertCall = (withTenantQuery as any).mock.calls[2];
    expect(insertCall[1]).toContain(800);
  });

  it('throws BAD_REQUEST when a shipment is for a different species', async () => {
    (ShipmentIntakeService.getShipment as any).mockResolvedValueOnce({
      id: SHIPMENT_1, species_id: 'some-other-species-id', weight_kg: 500,
    });

    await expect(
      ProcessingBatchService.createBatch(TENANT_ID, USER_ID, { ...validInput, shipmentIds: [SHIPMENT_1] })
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('throws CONFLICT when a shipment is already claimed by another batch', async () => {
    (ShipmentIntakeService.getShipment as any).mockResolvedValueOnce({
      id: SHIPMENT_1, species_id: SPECIES_ID, weight_kg: 500,
    });
    (withTenantQuery as any).mockResolvedValueOnce([{ batch_id: 'other-batch-id' }]);

    await expect(
      ProcessingBatchService.createBatch(TENANT_ID, USER_ID, { ...validInput, shipmentIds: [SHIPMENT_1] })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('throws FORBIDDEN when the species is inactive', async () => {
    (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
      id: SPECIES_ID, common_name: 'Atlantic Salmon', is_active: false,
    });

    await expect(
      ProcessingBatchService.createBatch(TENANT_ID, USER_ID, validInput)
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

describe('ProcessingBatchService.completeBatch', () => {
  it('throws BAD_REQUEST when finished weight exceeds raw input weight', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: BATCH_ID, status: 'open', raw_input_weight_kg: 800 },
    ]);

    await expect(
      ProcessingBatchService.completeBatch(TENANT_ID, BATCH_ID, USER_ID, {
        finishedWeightKg: 900,
        completedAt: '2026-07-15T14:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('throws CONFLICT when the batch is not open', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: BATCH_ID, status: 'completed', raw_input_weight_kg: 800 },
    ]);

    await expect(
      ProcessingBatchService.completeBatch(TENANT_ID, BATCH_ID, USER_ID, {
        finishedWeightKg: 500,
        completedAt: '2026-07-15T14:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('completes successfully with a valid finished weight', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: BATCH_ID, status: 'open', raw_input_weight_kg: 800 }])
      .mockResolvedValueOnce([{ id: BATCH_ID, status: 'completed', finished_weight_kg: 500 }]);

    const result = await ProcessingBatchService.completeBatch(TENANT_ID, BATCH_ID, USER_ID, {
      finishedWeightKg: 500,
      completedAt: '2026-07-15T14:00:00.000Z',
    });

    expect(result.status).toBe('completed');
    expect(result.finished_weight_kg).toBe(500);
  });
});

describe('ProcessingBatchService.cancelBatch', () => {
  it('cancels an open batch', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: BATCH_ID, status: 'open' }])
      .mockResolvedValueOnce([{ id: BATCH_ID, status: 'cancelled' }]);

    const result = await ProcessingBatchService.cancelBatch(TENANT_ID, BATCH_ID, USER_ID);
    expect(result.status).toBe('cancelled');
  });

  it('throws CONFLICT when trying to cancel a non-open batch', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: BATCH_ID, status: 'completed' }]);

    await expect(
      ProcessingBatchService.cancelBatch(TENANT_ID, BATCH_ID, USER_ID)
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });
});

describe('ProcessingBatchService.getBatch', () => {
  it('throws NOT_FOUND for a nonexistent batch', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      ProcessingBatchService.getBatch(TENANT_ID, BATCH_ID)
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('ProcessingBatchService.listBatches', () => {
  it('applies speciesId and status filters', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await ProcessingBatchService.listBatches(TENANT_ID, { speciesId: SPECIES_ID, status: 'open' });

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('species_id = $2');
    expect(call[0]).toContain('status = $3');
    expect(call[1]).toEqual([TENANT_ID, SPECIES_ID, 'open']);
  });
});
