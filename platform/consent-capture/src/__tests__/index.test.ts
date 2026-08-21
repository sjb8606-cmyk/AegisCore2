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
      requireGeoStamp: true,
      requireDeviceStamp: false,
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
  captureConsent,
  getConsentEventsForContract,
  __resetConsentCaptureStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const contractId = '00000000-0000-4000-8000-0000000000c1';

describe('consent-capture', () => {
  beforeEach(() => {
    __resetConsentCaptureStore();
    vi.clearAllMocks();
  });

  it('captures consent with geo and hash', async () => {
    const event = await captureConsent(tenantId, actorId, {
      contractId,
      consent: true,
      consentText: 'I agree to the foster liability terms.',
      geoData: { lat: 45.96, lng: -66.64 },
    });
    expect(event.consent).toBe(true);
    expect(event.consentTextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.geoLat).toBeCloseTo(45.96);
    expect(event.chainHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects consent=false', async () => {
    try {
      await captureConsent(tenantId, actorId, {
        contractId,
        consent: false as any,
        consentText: 'nope',
        geoData: { lat: 1, lng: 2 },
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/consent/i);
    }
  });

  it('requires geo when configured', async () => {
    try {
      await captureConsent(tenantId, actorId, {
        contractId,
        consent: true,
        consentText: 'terms',
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/geo/i);
    }
  });

  it('lists events for contract', async () => {
    await captureConsent(tenantId, actorId, {
      contractId,
      consent: true,
      consentText: 'terms v1',
      geoData: { lat: 1, lng: 2 },
    });
    const list = await getConsentEventsForContract(tenantId, contractId);
    expect(list).toHaveLength(1);
  });
});
