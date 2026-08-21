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
    loadConfig: vi.fn().mockImplementation((name: string) => {
      if (name === 'consent-capture') {
        return { enabled: true, requireGeoStamp: true, requireDeviceStamp: false };
      }
      return {
        enabled: true,
        niche: 'pet-foster',
        termsTemplate:
          'Foster agreement {{partyA}} / {{partyB}} for {{entity}} {{start}}-{{end}}',
        requiresConsentCapture: true,
      };
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
  createContract,
  signContract,
  getContract,
  __resetLiabilityContractsStore,
} from '../index';
import { __resetConsentCaptureStore } from '@platform/consent-capture';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('liability-contracts', () => {
  beforeEach(() => {
    __resetLiabilityContractsStore();
    __resetConsentCaptureStore();
    vi.clearAllMocks();
  });

  it('creates a draft with terms hash', async () => {
    const c = await createContract(tenantId, actorId, {
      partyAId: 'shelter-1',
      partyBId: 'foster-1',
      entityId: 'animal-42',
      startTime: '2026-01-01',
      endTime: '2026-01-07',
    });
    expect(c.status).toBe('draft');
    expect(c.termsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.termsText).toContain('foster-1');
  });

  it('signs with consent capture', async () => {
    const c = await createContract(tenantId, actorId, {
      partyAId: 'a',
      partyBId: 'b',
    });
    const signed = await signContract(tenantId, actorId, c.id, {
      geoData: { lat: 45.9, lng: -66.6 },
    });
    expect(signed.status).toBe('signed');
    expect(signed.signature).toBeTruthy();
    expect(signed.consentEventId).toBeTruthy();
  });

  it('rejects double sign', async () => {
    const c = await createContract(tenantId, actorId, {
      partyAId: 'a',
      partyBId: 'b',
    });
    await signContract(tenantId, actorId, c.id, {
      geoData: { lat: 1, lng: 2 },
    });
    try {
      await signContract(tenantId, actorId, c.id, {
        geoData: { lat: 1, lng: 2 },
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/status|sign/i);
    }
  });

  it('getContract returns record', async () => {
    const c = await createContract(tenantId, actorId, {
      partyAId: 'a',
      partyBId: 'b',
    });
    const got = await getContract(tenantId, c.id);
    expect(got?.id).toBe(c.id);
  });
});
