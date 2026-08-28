import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn()
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn()
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn()

  };
});

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
  __resetSaltBrineApplicationLogStore,
  logApplication,
  getLiabilityDefenseRecord
} from '../index';

describe('salt-brine-application-log', () => {
  beforeEach(() => {
    __resetSaltBrineApplicationLogStore();
  });

  it('logs a GPS-tagged salt application', async () => {
    const result = await logApplication(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      'salt',
      250,
      46.0878,
      -64.7782
    );

    expect(result.materialType).toBe('salt');
    expect(result.quantityApplied).toBe(250);
    expect(result.gpsLat).toBe(46.0878);
  });

  it('rejects invalid GPS coordinates', async () => {
    await expect(
      logApplication(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        'brine',
        100,
        95,
        -64
      )
    ).rejects.toThrow();
  });

  it('returns only the tenant property records in the requested range', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();

    await logApplication(
      tenantId,
      actorId,
      crypto.randomUUID(),
      propertyId,
      'salt',
      100,
      46,
      -64
    );

    await logApplication(
      crypto.randomUUID(),
      actorId,
      crypto.randomUUID(),
      propertyId,
      'sand',
      100,
      46,
      -64
    );

    const records = await getLiabilityDefenseRecord(
      tenantId,
      actorId,
      propertyId,
      '2000-01-01T00:00:00.000Z',
      '2100-01-01T00:00:00.000Z'
    );

    expect(records).toHaveLength(1);
    expect(records[0].tenantId).toBe(tenantId);
  });
});
