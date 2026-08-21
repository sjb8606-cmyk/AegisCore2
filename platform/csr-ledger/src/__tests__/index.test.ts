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
      defaultPeriod: 'monthly',
      requireShiftId: false,
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
  createPartner,
  __resetCsrPartnersStore,
} from '@platform/csr-partners';
import {
  logHours,
  getPartnerHourSummary,
  generatePartnerReport,
  __resetCsrLedgerStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const employeeId = '00000000-0000-4000-8000-0000000000ee';

describe('csr-ledger', () => {
  beforeEach(() => {
    __resetCsrPartnersStore();
    __resetCsrLedgerStore();
    vi.clearAllMocks();
  });

  it('logs hours and summarizes against pledge', async () => {
    const partner = await createPartner(tenantId, actorId, {
      companyName: 'Acme',
      contactEmail: 'csr@acme.com',
      pledgedHoursPerPeriod: 40,
    });
    await logHours(tenantId, actorId, {
      csrPartnerId: partner.id,
      employeeActorId: employeeId,
      hoursLogged: 4,
      verified: true,
    });
    const summary = await getPartnerHourSummary(tenantId, partner.id);
    expect(summary.logged).toBe(4);
    expect(summary.verified).toBe(4);
    expect(summary.remaining).toBe(36);
  });

  it('generatePartnerReport includes hash', async () => {
    const partner = await createPartner(tenantId, actorId, {
      companyName: 'Acme',
      contactEmail: 'csr@acme.com',
      pledgedHoursPerPeriod: 20,
    });
    await logHours(tenantId, actorId, {
      csrPartnerId: partner.id,
      employeeActorId: employeeId,
      hoursLogged: 2,
      contractId: 'c1',
    });
    const report = await generatePartnerReport(tenantId, actorId, partner.id);
    expect(report.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.contractIds).toContain('c1');
  });
});
