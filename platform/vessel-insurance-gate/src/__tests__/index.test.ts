import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      blockWhenExpired: true,
      expiryWarningDays: 30,
      minLiabilityCents: 100000000,
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  registerCOI,
  assertVesselInsurable,
  listExpiringCOIs,
  revokeCOI,
  __resetVesselInsuranceStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const vesselId = 'vessel-1';

describe('vessel-insurance-gate', () => {
  beforeEach(() => {
    __resetVesselInsuranceStore();
    vi.clearAllMocks();
  });

  it('blocks berth when no COI', async () => {
    await expect(assertVesselInsurable(tenantId, vesselId)).rejects.toThrow(
      /not insurable/i,
    );
  });

  it('allows when valid COI meets min liability', async () => {
    await registerCOI(tenantId, actorId, {
      vesselId,
      carrier: 'BoatInsure Co',
      policyNumber: 'POL-1',
      liabilityCents: 200000000,
      effectiveAt: '2026-01-01',
      expiresAt: '2027-01-01',
    });
    const result = await assertVesselInsurable(tenantId, vesselId);
    expect(result.insurable).toBe(true);
  });

  it('blocks expired and lists expiring', async () => {
    const coi = await registerCOI(tenantId, actorId, {
      vesselId,
      carrier: 'Old',
      policyNumber: 'OLD',
      liabilityCents: 200000000,
      effectiveAt: '2020-01-01',
      expiresAt: '2021-01-01',
    });
    await expect(assertVesselInsurable(tenantId, vesselId)).rejects.toThrow(
      /not insurable/i,
    );
    await registerCOI(tenantId, actorId, {
      vesselId: 'vessel-2',
      carrier: 'Soon',
      policyNumber: 'S1',
      liabilityCents: 200000000,
      effectiveAt: '2026-01-01',
      expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    });
    const expiring = await listExpiringCOIs(tenantId, actorId, 30);
    expect(expiring.length).toBeGreaterThanOrEqual(1);
    await revokeCOI(tenantId, actorId, coi.id);
  });
});
