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
      wawaBufferMeters: 30,
      maxFieldsPerTenant: 500,
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
  registerField,
  calculateWawaSetback,
  flagRestrictedZone,
  getRestrictedZones,
  getFieldsNearPoint,
  __resetAgFieldRegistryStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

const samplePoly = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-66.1, 45.2],
      [-66.09, 45.2],
      [-66.09, 45.21],
      [-66.1, 45.21],
      [-66.1, 45.2],
    ],
  ],
};

describe('ag-field-registry', () => {
  beforeEach(() => {
    __resetAgFieldRegistryStore();
    vi.clearAllMocks();
  });

  it('registers field and computes WAWA setback', async () => {
    const field = await registerField(tenantId, actorId, {
      name: 'North 40',
      pidNumber: 'PID-123',
      armsId: 'ARMS-9',
      boundaryGeoJson: samplePoly,
      acres: 40,
    });
    expect(field.id).toBeTruthy();
    const setback = await calculateWawaSetback(tenantId, field.id);
    expect(setback.bufferMeters).toBe(30);
    expect(setback.setbackGeoJson.type).toBe('Polygon');
  });

  it('flags restricted zone', async () => {
    const field = await registerField(tenantId, actorId, {
      name: 'Creek Field',
      boundaryGeoJson: samplePoly,
      acres: 12,
    });
    const zone = await flagRestrictedZone(tenantId, actorId, {
      fieldId: field.id,
      zoneType: 'wawa_buffer',
      geometry: samplePoly,
      reason: 'Clean Water Act 30m buffer',
    });
    expect(zone.zoneType).toBe('wawa_buffer');
    expect((await getRestrictedZones(tenantId, field.id)).length).toBe(1);
  });

  it('finds fields near a point', async () => {
    await registerField(tenantId, actorId, {
      name: 'Near',
      boundaryGeoJson: samplePoly,
      acres: 5,
    });
    const near = await getFieldsNearPoint(tenantId, 45.205, -66.095, 5000);
    expect(near.length).toBeGreaterThanOrEqual(1);
  });
});
