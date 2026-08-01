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
vi.mock('../../../processing-batch/src/index', () => ({
  ProcessingBatchService: { getBatch: vi.fn() },
}));

import { YieldEngineService, ErrorCode } from '../index';
import { withTenantQuery } from '../../../../tenancy/src/index';
import { loadConfig } from '../../../../utils/src/index';
import { SpeciesRegistryService } from '../../../species-registry/src/index';
import { ProcessingBatchService } from '../../../processing-batch/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SPECIES_ID = '33333333-3333-3333-3333-333333333333';
const BATCH_ID = '66666666-6666-6666-6666-666666666666';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, limits: { underperformanceThresholdPoints: 5 } });
});

describe('YieldEngineService.computeYield', () => {
  it('computes real yield % with no baseline set — not flagged, deviation is null', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'record-1', actual_yield_percent: 62.5, deviation_points: null }]);
    (ProcessingBatchService.getBatch as any).mockResolvedValue({
      id: BATCH_ID, species_id: SPECIES_ID, status: 'completed',
      raw_input_weight_kg: 800, finished_weight_kg: 500,
    });
    (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
      id: SPECIES_ID, default_yield_rate_percent: null,
    });

    const result = await YieldEngineService.computeYield(TENANT_ID, BATCH_ID, USER_ID);

    expect(result.actual_yield_percent).toBe(62.5);
    const insertCall = (withTenantQuery as any).mock.calls[1];
    expect(insertCall[1][3]).toBe(62.5);
    expect(insertCall[1][6]).toBe(false);
  });

  it('flags underperformance when actual yield falls below the threshold under baseline', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'record-1', is_underperforming: true }]);
    (ProcessingBatchService.getBatch as any).mockResolvedValue({
      id: BATCH_ID, species_id: SPECIES_ID, status: 'completed',
      raw_input_weight_kg: 800, finished_weight_kg: 400,
    });
    (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
      id: SPECIES_ID, default_yield_rate_percent: 62,
    });

    const result = await YieldEngineService.computeYield(TENANT_ID, BATCH_ID, USER_ID);
    expect(result.is_underperforming).toBe(true);

    const insertCall = (withTenantQuery as any).mock.calls[1];
    expect(insertCall[1][3]).toBe(50);
    expect(insertCall[1][4]).toBe(62);
    expect(insertCall[1][5]).toBe(-12);
    expect(insertCall[1][6]).toBe(true);
  });

  it('does NOT flag when the deviation is within the configured threshold', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'record-1' }]);
    (ProcessingBatchService.getBatch as any).mockResolvedValue({
      id: BATCH_ID, species_id: SPECIES_ID, status: 'completed',
      raw_input_weight_kg: 800, finished_weight_kg: 472,
    });
    (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
      id: SPECIES_ID, default_yield_rate_percent: 62,
    });

    await YieldEngineService.computeYield(TENANT_ID, BATCH_ID, USER_ID);

    const insertCall = (withTenantQuery as any).mock.calls[1];
    expect(insertCall[1][6]).toBe(false);
  });

  it('throws CONFLICT when yield was already computed for this batch', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'existing-record' }]);

    await expect(
      YieldEngineService.computeYield(TENANT_ID, BATCH_ID, USER_ID)
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(ProcessingBatchService.getBatch).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the batch is not completed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    (ProcessingBatchService.getBatch as any).mockResolvedValue({
      id: BATCH_ID, status: 'open', raw_input_weight_kg: 800, finished_weight_kg: null,
    });

    await expect(
      YieldEngineService.computeYield(TENANT_ID, BATCH_ID, USER_ID)
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });
});

describe('YieldEngineService.getYieldForBatch', () => {
  it('throws NOT_FOUND when yield has not been computed yet', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      YieldEngineService.getYieldForBatch(TENANT_ID, BATCH_ID)
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('YieldEngineService.listYieldRecords', () => {
  it('applies the underperformingOnly filter', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await YieldEngineService.listYieldRecords(TENANT_ID, { underperformingOnly: true });

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('is_underperforming = true');
  });
});

describe('YieldEngineService.getAverageYieldForSpecies', () => {
  it('returns the real average', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ avg_yield: '58.33' }]);

    const avg = await YieldEngineService.getAverageYieldForSpecies(TENANT_ID, SPECIES_ID);
    expect(avg).toBe(58.33);
  });

  it('returns null (not a fabricated 0) when there is no real data yet', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ avg_yield: null }]);

    const avg = await YieldEngineService.getAverageYieldForSpecies(TENANT_ID, SPECIES_ID);
    expect(avg).toBeNull();
  });
});
