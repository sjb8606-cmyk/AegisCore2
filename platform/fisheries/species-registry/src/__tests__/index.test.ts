import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../utils/src/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/src/index')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

import { SpeciesRegistryService, ErrorCode } from '../index';
import { withTenantQuery } from '../../../../tenancy/src/index';
import { loadConfig } from '../../../../utils/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SPECIES_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, limits: { speciesCount: 200 } });
});

describe('SpeciesRegistryService.createSpecies', () => {
  const validInput = {
    commonName: 'Atlantic Salmon',
    scientificName: 'Salmo salar',
    speciesCode: 'SALM-ATL',
    category: 'finfish',
    defaultYieldRatePercent: 62.5,
  };

  it('creates a real species row', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: 5 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: SPECIES_ID, common_name: 'Atlantic Salmon' }]);

    const result = await SpeciesRegistryService.createSpecies(TENANT_ID, USER_ID, validInput);
    expect(result.common_name).toBe('Atlantic Salmon');
  });

  it('throws CONFLICT for a duplicate species_code within the same tenant', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: 5 }])
      .mockResolvedValueOnce([{ id: 'existing-id' }]);

    await expect(
      SpeciesRegistryService.createSpecies(TENANT_ID, USER_ID, validInput)
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('throws FORBIDDEN when the species limit is reached', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ count: 200 }]);

    await expect(
      SpeciesRegistryService.createSpecies(TENANT_ID, USER_ID, validInput)
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('throws BAD_REQUEST for an invalid userId', async () => {
    await expect(
      SpeciesRegistryService.createSpecies(TENANT_ID, 'not-a-uuid', validInput)
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });
});

describe('SpeciesRegistryService.getSpecies', () => {
  it('throws NOT_FOUND for a nonexistent species', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      SpeciesRegistryService.getSpecies(TENANT_ID, SPECIES_ID)
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('SpeciesRegistryService.listSpecies', () => {
  it('filters to active-only by default', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await SpeciesRegistryService.listSpecies(TENANT_ID);

    expect(withTenantQuery).toHaveBeenCalledWith(
      expect.stringContaining('is_active = true'),
      [TENANT_ID],
      TENANT_ID
    );
  });

  it('includes inactive species when activeOnly is false', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await SpeciesRegistryService.listSpecies(TENANT_ID, { activeOnly: false });

    expect(withTenantQuery).toHaveBeenCalledWith(
      expect.not.stringContaining('is_active = true'),
      [TENANT_ID],
      TENANT_ID
    );
  });
});

describe('SpeciesRegistryService.updateSpecies', () => {
  it('only updates the fields that were actually provided', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: SPECIES_ID }])
      .mockResolvedValueOnce([{ id: SPECIES_ID, common_name: 'Updated Name' }]);

    const result = await SpeciesRegistryService.updateSpecies(TENANT_ID, SPECIES_ID, USER_ID, {
      commonName: 'Updated Name',
    });

    expect(result.common_name).toBe('Updated Name');
    const updateCall = (withTenantQuery as any).mock.calls[1];
    expect(updateCall[0]).toContain('common_name = $1');
    expect(updateCall[0]).not.toContain('scientific_name');
  });

  it('throws BAD_REQUEST when no fields are provided', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: SPECIES_ID }]);

    await expect(
      SpeciesRegistryService.updateSpecies(TENANT_ID, SPECIES_ID, USER_ID, {})
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });
});

describe('SpeciesRegistryService.deactivateSpecies', () => {
  it('soft-deactivates rather than physically deleting', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: SPECIES_ID }])
      .mockResolvedValueOnce([{ id: SPECIES_ID, is_active: false }]);

    const result = await SpeciesRegistryService.deactivateSpecies(TENANT_ID, SPECIES_ID, USER_ID);

    expect(result.is_active).toBe(false);
    const updateCall = (withTenantQuery as any).mock.calls[1];
    expect(updateCall[0]).toContain('is_active = false');
    expect(updateCall[0]).not.toContain('DELETE');
  });
});
