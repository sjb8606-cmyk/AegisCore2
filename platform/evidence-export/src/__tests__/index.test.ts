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
      formats: ['json', 'pdf'],
      includeAuditTrail: true,
    }),
  };
});

vi.mock('@platform/liability-contracts', () => ({
  getContract: vi.fn().mockResolvedValue({
    id: 'c1',
    tenantId: '00000000-0000-4000-8000-000000000001',
    status: 'signed',
    termsHash: 'abc',
  }),
}));

vi.mock('@platform/consent-capture', () => ({
  getConsentEventsForContract: vi.fn().mockResolvedValue([
    { id: 'ce1', contractId: 'c1', consentTextHash: 'h1' },
  ]),
}));

vi.mock('@platform/incident-breaker', () => ({
  listIncidents: vi.fn().mockResolvedValue([]),
}));

vi.mock('@platform/worm-audit', () => ({
  queryAuditLog: vi.fn().mockResolvedValue([
    { id: 'a1', action: 'contract.signed', entityId: 'c1' },
  ]),
}));

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  exportContractEvidence,
  getEvidenceBundle,
  __resetEvidenceExportStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('evidence-export', () => {
  beforeEach(() => {
    __resetEvidenceExportStore();
    vi.clearAllMocks();
  });

  it('exports json bundle with hash', async () => {
    const bundle = await exportContractEvidence(tenantId, actorId, 'c1', 'json');
    expect(bundle.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.consentEvents).toHaveLength(1);
    expect(bundle.auditTrail).toHaveLength(1);
    expect((bundle.payload as any).bundleHash).toBe(bundle.bundleHash);
  });

  it('exports pdf placeholder with downloadUrl', async () => {
    const bundle = await exportContractEvidence(tenantId, actorId, 'c1', 'pdf');
    expect(bundle.downloadUrl).toMatch(/\.pdf$/);
  });

  it('getEvidenceBundle returns stored export', async () => {
    const bundle = await exportContractEvidence(tenantId, actorId, 'c1', 'json');
    const got = await getEvidenceBundle(tenantId, bundle.id);
    expect(got?.id).toBe(bundle.id);
  });
});
