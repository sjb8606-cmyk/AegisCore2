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
      defaultExpiryWarningDays: 30,
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
  registerCertification,
  getExpiringCertifications,
  isCertValid,
  generateInspectionPrepReport,
  setCycleProvider,
  setApplicationProvider,
  __resetAgComplianceDocsStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('ag-compliance-docs', () => {
  beforeEach(() => {
    __resetAgComplianceDocsStore();
    vi.clearAllMocks();
  });

  it('registers cert and detects expiry window', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const issue = new Date(Date.now() - 365 * 86_400_000).toISOString();
    await registerCertification(tenantId, actorId, {
      certType: 'class_l_pesticide',
      holderId: 'operator-1',
      certNumber: 'CL-999',
      issueDate: issue,
      expiryDate: soon,
    });
    const expiring = await getExpiringCertifications(tenantId, 30);
    expect(expiring.length).toBe(1);
    expect(
      await isCertValid(tenantId, 'operator-1', 'class_l_pesticide'),
    ).toBe(true);
  });

  it('rejects expiry before issue', async () => {
    await expect(
      registerCertification(tenantId, actorId, {
        certType: 'organic',
        holderId: 'h1',
        certNumber: 'O-1',
        issueDate: '2026-06-01',
        expiryDate: '2026-01-01',
      }),
    ).rejects.toThrow(/after issueDate/i);
  });

  it('builds inspection prep report from providers', async () => {
    setCycleProvider(async () => [
      {
        fieldId: 'f1',
        cycleId: 'c1',
        cropType: 'potato',
        eventCount: 4,
        status: 'closed',
      },
    ]);
    setApplicationProvider(async () => [
      { product: 'Herb-X', fieldId: 'f1' },
    ]);
    await registerCertification(tenantId, actorId, {
      certType: 'commercial_applicator',
      holderId: 'op',
      certNumber: 'CA-1',
      issueDate: '2024-01-01',
      expiryDate: '2027-01-01',
    });
    const report = await generateInspectionPrepReport(tenantId, actorId, {
      fieldIds: ['f1'],
      dateRange: { from: '2026-01-01', to: '2026-12-31' },
    });
    expect(report.cycleSummaries).toHaveLength(1);
    expect(report.applicationRecords).toHaveLength(1);
    expect(report.certifications.length).toBeGreaterThanOrEqual(1);
  });
});
