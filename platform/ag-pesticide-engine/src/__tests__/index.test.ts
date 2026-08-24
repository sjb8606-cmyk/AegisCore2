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
      maxWindSpeedKmh: 20,
      requireCertTypes: ['class_l_pesticide', 'commercial_applicator'],
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
  seedPmraLabel,
  setCertCheckFn,
  setRestrictedZoneFn,
  setLogCropEventFn,
  logApplication,
  checkHarvestEligibility,
  releaseHarvestLock,
  __resetAgPesticideEngineStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('ag-pesticide-engine', () => {
  beforeEach(() => {
    __resetAgPesticideEngineStore();
    vi.clearAllMocks();
    seedPmraLabel({
      pmraRegistrationNumber: 'PMRA-1001',
      productName: 'Herb-Safe',
      maxRatePerHa: 2.5,
      phiDays: 7,
      reiHours: 12,
    });
    setCertCheckFn(async () => true);
    setRestrictedZoneFn(async () => []);
    setLogCropEventFn(async () => {});
  });

  it('logs application, sets PHI lock, blocks harvest', async () => {
    const app = await logApplication(tenantId, actorId, {
      fieldId: 'field-1',
      cropCycleId: 'cycle-1',
      productName: 'Herb-Safe',
      pmraRegistrationNumber: 'PMRA-1001',
      rateAppliedPerHa: 2.0,
      windSpeedKmh: 8,
    });
    expect(app.phiUnlockAt).toBeTruthy();
    const elig = await checkHarvestEligibility(tenantId, 'field-1');
    expect(elig.eligible).toBe(false);
    expect(elig.locked).toBe(true);
  });

  it('blocks without cert, over rate, restricted zone, high wind', async () => {
    setCertCheckFn(async () => false);
    await expect(
      logApplication(tenantId, actorId, {
        fieldId: 'f1',
        cropCycleId: 'c1',
        productName: 'Herb-Safe',
        pmraRegistrationNumber: 'PMRA-1001',
        rateAppliedPerHa: 1,
        windSpeedKmh: 5,
      }),
    ).rejects.toThrow(/certificate/i);

    setCertCheckFn(async () => true);
    await expect(
      logApplication(tenantId, actorId, {
        fieldId: 'f1',
        cropCycleId: 'c1',
        productName: 'Herb-Safe',
        pmraRegistrationNumber: 'PMRA-1001',
        rateAppliedPerHa: 9,
        windSpeedKmh: 5,
      }),
    ).rejects.toThrow(/exceeds PMRA/i);

    setRestrictedZoneFn(async () => [
      { zoneType: 'wawa_buffer', reason: '30m buffer' },
    ]);
    await expect(
      logApplication(tenantId, actorId, {
        fieldId: 'f1',
        cropCycleId: 'c1',
        productName: 'Herb-Safe',
        pmraRegistrationNumber: 'PMRA-1001',
        rateAppliedPerHa: 1,
        windSpeedKmh: 5,
      }),
    ).rejects.toThrow(/restricted zone/i);

    setRestrictedZoneFn(async () => []);
    await expect(
      logApplication(tenantId, actorId, {
        fieldId: 'f1',
        cropCycleId: 'c1',
        productName: 'Herb-Safe',
        pmraRegistrationNumber: 'PMRA-1001',
        rateAppliedPerHa: 1,
        windSpeedKmh: 40,
      }),
    ).rejects.toThrow(/Wind speed/i);
  });

  it('rejects force release without gate approval', async () => {
    await logApplication(tenantId, actorId, {
      fieldId: 'field-2',
      cropCycleId: 'c2',
      productName: 'Herb-Safe',
      pmraRegistrationNumber: 'PMRA-1001',
      rateAppliedPerHa: 1,
      windSpeedKmh: 5,
    });
    await expect(
      releaseHarvestLock(tenantId, actorId, 'field-2', { force: true }),
    ).rejects.toThrow(/Synchronous Gate/i);

    const released = await releaseHarvestLock(tenantId, actorId, 'field-2', {
      force: true,
      gateApproved: true,
    });
    expect(released.locked).toBe(false);
  });
});
