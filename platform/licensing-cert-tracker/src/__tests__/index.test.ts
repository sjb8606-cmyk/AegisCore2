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
      blockBookingWhenExpired: true,
      expiryWarningDays: 30,
      requiredLicenseTypes: ['cosmetology'],
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
  registerLicense,
  assertBookable,
  listExpiringLicenses,
  revokeLicense,
  __resetLicensingCertStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const staffId = '00000000-0000-4000-8000-0000000000bb';

describe('licensing-cert-tracker', () => {
  beforeEach(() => {
    __resetLicensingCertStore();
    vi.clearAllMocks();
  });

  it('blocks booking without required license', async () => {
    await expect(assertBookable(tenantId, staffId)).rejects.toThrow(
      /not bookable/i,
    );
  });

  it('allows booking with valid cosmetology license', async () => {
    await registerLicense(tenantId, actorId, {
      staffId,
      licenseType: 'cosmetology',
      licenseNumber: 'COS-123',
      issuedAt: '2024-01-01',
      expiresAt: '2027-01-01',
    });
    const result = await assertBookable(tenantId, staffId);
    expect(result.bookable).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('blocks expired license and lists expiring', async () => {
    const lic = await registerLicense(tenantId, actorId, {
      staffId,
      licenseType: 'cosmetology',
      licenseNumber: 'COS-OLD',
      issuedAt: '2020-01-01',
      expiresAt: '2021-01-01',
    });
    await expect(assertBookable(tenantId, staffId)).rejects.toThrow(/expired/i);

    await registerLicense(tenantId, actorId, {
      staffId: '00000000-0000-4000-8000-0000000000cc',
      licenseType: 'cosmetology',
      licenseNumber: 'COS-SOON',
      issuedAt: '2025-01-01',
      expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    });
    const expiring = await listExpiringLicenses(tenantId, actorId, 30);
    expect(expiring.length).toBeGreaterThanOrEqual(1);
    await revokeLicense(tenantId, actorId, lic.id);
  });
});
