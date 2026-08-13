import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = { query: vi.fn() };

vi.mock('@platform/tenancy', () => {
  async function withTenantTransaction(fn: (client: any) => Promise<any>, tenantId: string) {
    if (!tenantId) throw new Error('Tenant ID Mandatory');
    await mockClient.query('BEGIN');
    await mockClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(mockClient);
    await mockClient.query('COMMIT');
    return result;
  }
  return {
    withTenant: (tenantId: string, fn: (client: any) => Promise<any>) => withTenantTransaction(fn, tenantId),
    withTenantQuery: (sql: string, params: any[], tenantId: string) =>
      withTenantTransaction(async (client) => (await client.query(sql, params)).rows, tenantId),
  };
});

vi.mock('@platform/lot-traceability', () => ({
  LotTraceabilityService: { getLot: vi.fn() },
}));

vi.mock('@platform/species-registry', () => ({
  SpeciesRegistryService: { getSpecies: vi.fn() },
}));

import { LabellingEngineService, ErrorCode } from '../index';
import { LotTraceabilityService } from '@platform/lot-traceability';
import { SpeciesRegistryService } from '@platform/species-registry';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const LOT_ID = '33333333-3333-3333-3333-333333333333';
const SPECIES_ID = '44444444-4444-4444-4444-444444444444';
const LABEL_ID = '55555555-5555-5555-5555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
});

function mockGetMarketRulesThenInsert(rulesRow: any, insertRow: any) {
  mockClient.query
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(rulesRow === null ? { rows: [] } : { rows: [rulesRow] })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ rows: [insertRow] })
    .mockResolvedValueOnce(undefined);
}

describe('LabellingEngineService.generateLabel — no rules configured', () => {
  it('is honest that it cannot validate, rather than silently marking the label valid', async () => {
    (LotTraceabilityService.getLot as any).mockResolvedValue({
      id: LOT_ID, lot_code: 'LOT-001', quantity: 100, unit: 'kg', metadata: {},
    });
    mockGetMarketRulesThenInsert(null, { id: LABEL_ID, is_valid: false, missing_fields: [] });

    const result = await LabellingEngineService.generateLabel(TENANT_ID, USER_ID, LOT_ID, { market: 'domestic' });

    expect(result.rulesConfigured).toBe(false);
    expect(result.isValid).toBe(false);
    expect(SpeciesRegistryService.getSpecies).not.toHaveBeenCalled();
  });
});

describe('LabellingEngineService.generateLabel — species lookup', () => {
  it('does not fabricate a French species name — flags it missing rather than inventing one', async () => {
    (LotTraceabilityService.getLot as any).mockResolvedValue({
      id: LOT_ID, lot_code: 'LOT-002', quantity: 50, unit: 'kg', metadata: { speciesId: SPECIES_ID },
    });
    (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
      common_name: 'Atlantic Lobster', scientific_name: 'Homarus americanus',
    });
    mockGetMarketRulesThenInsert(
      { market: 'eu_export', required_fields: ['lotCode', 'speciesNameEn'], bilingual_required: true },
      { id: LABEL_ID, is_valid: false, missing_fields: ['speciesNameFr'] },
    );

    const result = await LabellingEngineService.generateLabel(TENANT_ID, USER_ID, LOT_ID, { market: 'eu_export' });

    expect(SpeciesRegistryService.getSpecies).toHaveBeenCalledWith(TENANT_ID, SPECIES_ID);
    expect(result.isValid).toBe(false);
    expect(result.missingFields).toContain('speciesNameFr');
  });

  it('validates successfully when the caller supplies a real French name and all required fields resolve', async () => {
    (LotTraceabilityService.getLot as any).mockResolvedValue({
      id: LOT_ID, lot_code: 'LOT-003', quantity: 75, unit: 'kg', metadata: { speciesId: SPECIES_ID },
    });
    (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
      common_name: 'Atlantic Lobster', scientific_name: 'Homarus americanus',
    });
    mockGetMarketRulesThenInsert(
      { market: 'eu_export', required_fields: ['lotCode', 'speciesNameEn'], bilingual_required: true },
      { id: LABEL_ID, is_valid: true, missing_fields: [] },
    );

    const result = await LabellingEngineService.generateLabel(TENANT_ID, USER_ID, LOT_ID, {
      market: 'eu_export',
      speciesNameFr: 'Homard d\u2019Atlantique',
    });

    expect(result.isValid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('never calls species-registry when the lot has no speciesId in metadata', async () => {
    (LotTraceabilityService.getLot as any).mockResolvedValue({
      id: LOT_ID, lot_code: 'LOT-004', quantity: 10, unit: 'kg', metadata: {},
    });
    mockGetMarketRulesThenInsert(
      { market: 'domestic', required_fields: ['lotCode'], bilingual_required: false },
      { id: LABEL_ID, is_valid: true, missing_fields: [] },
    );

    await LabellingEngineService.generateLabel(TENANT_ID, USER_ID, LOT_ID, { market: 'domestic' });
    expect(SpeciesRegistryService.getSpecies).not.toHaveBeenCalled();
  });
});

describe('LabellingEngineService.generateLabel — missing required fields', () => {
  it('flags a configured-but-missing field as invalid', async () => {
    (LotTraceabilityService.getLot as any).mockResolvedValue({
      id: LOT_ID, lot_code: 'LOT-005', quantity: 20, unit: 'kg', metadata: {},
    });
    mockGetMarketRulesThenInsert(
      { market: 'us_export', required_fields: ['lotCode', 'countryOfOrigin'], bilingual_required: false },
      { id: LABEL_ID, is_valid: false, missing_fields: ['countryOfOrigin'] },
    );

    const result = await LabellingEngineService.generateLabel(TENANT_ID, USER_ID, LOT_ID, { market: 'us_export' });
    expect(result.isValid).toBe(false);
    expect(result.missingFields).toContain('countryOfOrigin');
  });
});

describe('LabellingEngineService.setMarketRules', () => {
  it('rejects an empty requiredFields array before any database call', async () => {
    await expect(
      LabellingEngineService.setMarketRules(TENANT_ID, USER_ID, { market: 'domestic', requiredFields: [] }),
    ).rejects.toThrow();

    expect(mockClient.query).not.toHaveBeenCalled();
  });
});

describe('LabellingEngineService.getMarketRules', () => {
  it('returns null (not an error) when no rules have been configured for a market yet', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);

    const rules = await LabellingEngineService.getMarketRules(TENANT_ID, 'domestic');
    expect(rules).toBeNull();
  });
});

describe('LabellingEngineService.getLabel', () => {
  it('throws NOT_FOUND for a nonexistent label', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);

    await expect(LabellingEngineService.getLabel(TENANT_ID, LABEL_ID)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});
