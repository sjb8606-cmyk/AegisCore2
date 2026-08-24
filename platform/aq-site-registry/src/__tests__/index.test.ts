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
      defaultExpiryWarningDays: 90,
      maxSitesPerTenant: 200,
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
  registerSite,
  getSiteAuthorization,
  checkExpiry,
  isSpeciesAuthorized,
  getSite,
  __resetAqSiteRegistryStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

const bayPoly = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-66.5, 45.0],
      [-66.4, 45.0],
      [-66.4, 45.1],
      [-66.5, 45.1],
      [-66.5, 45.0],
    ],
  ],
};

describe('aq-site-registry', () => {
  beforeEach(() => {
    __resetAqSiteRegistryStore();
    vi.clearAllMocks();
  });

  it('registers site and returns authorization', async () => {
    const site = await registerSite(tenantId, actorId, {
      siteName: 'Bay Pen 3',
      leaseNumber: 'L-100',
      licenceNumber: 'LIC-55',
      boundaryGeoJson: bayPoly,
      areaHectares: 12.5,
      speciesAuthorized: ['Atlantic salmon', 'Rainbow trout'],
      cultureMethod: 'net_pen',
      tenureType: 'lease',
      expiryDate: new Date(Date.now() + 400 * 86_400_000).toISOString(),
    });
    const auth = await getSiteAuthorization(tenantId, site.id);
    expect(auth.speciesAuthorized).toContain('Atlantic salmon');
    expect(auth.cultureMethod).toBe('net_pen');
    const full = await getSite(tenantId, site.id);
    expect(isSpeciesAuthorized(full!, 'atlantic salmon')).toBe(true);
    expect(isSpeciesAuthorized(full!, 'oyster')).toBe(false);
  });

  it('flags sites expiring within window', async () => {
    await registerSite(tenantId, actorId, {
      siteName: 'Near expiry',
      boundaryGeoJson: bayPoly,
      areaHectares: 2,
      speciesAuthorized: ['mussel'],
      cultureMethod: 'longline',
      tenureType: 'occupation_permit',
      expiryDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    const expiring = await checkExpiry(tenantId, 90);
    expect(expiring.length).toBe(1);
  });

  it('rejects invalid culture method', async () => {
    await expect(
      registerSite(tenantId, actorId, {
        siteName: 'Bad',
        boundaryGeoJson: bayPoly,
        areaHectares: 1,
        speciesAuthorized: ['x'],
        cultureMethod: 'submarine' as any,
        tenureType: 'lease',
        expiryDate: '2030-01-01',
      }),
    ).rejects.toThrow(/cultureMethod/i);
  });
});
