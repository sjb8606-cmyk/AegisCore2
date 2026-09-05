import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false), // force default config for every test
  readFileSync: vi.fn(),
}));

import { withTenantQuery } from '../../../tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ENTITY_ID = '22222222-2222-2222-2222-222222222222';
const POLICY_ID = '33333333-3333-3333-3333-333333333333';

// loadConfig() caches in a module-private closure with no reset hook — same
// issue as ai-coach. Fresh module import per test avoids stale-config bleed.
async function freshService() {
  vi.resetModules();
  const mod = await import('../index');
  return mod.AiComplianceService;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runComplianceCheck', () => {
  // BUG — schema says entity_id is optional, but the implementation requires
  // it unconditionally via parseUserId(). A caller who legitimately omits
  // entity_id (e.g. a tenant-wide check with no specific entity) gets a hard
  // failure the schema promised wouldn't happen.
  it('BUG: throws when entity_id is omitted, even though the schema marks it optional', async () => {
    const AiComplianceService = await freshService();
    await expect(
      AiComplianceService.runComplianceCheck(TENANT_ID, { entity_type: 'tenant_config' })
    ).rejects.toThrow();
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  // KNOWN DEFECT — documented, not hidden.
  // No actual check is performed against entity_type or any real policy data.
  // Every call returns the identical hardcoded 'pass' + risk_score: 0.15 +
  // canned checks_performed list, whether the entity is compliant or not.
  it('DEFECT: always returns a hardcoded "pass" result regardless of entity_type', async () => {
    const AiComplianceService = await freshService();
    (withTenantQuery as any).mockResolvedValue([{ id: 'check-1', status: 'pass' }]);

    const resultA = await AiComplianceService.runComplianceCheck(TENANT_ID, {
      entity_type: 'user_account',
      entity_id: ENTITY_ID,
    });
    const resultB = await AiComplianceService.runComplianceCheck(TENANT_ID, {
      entity_type: 'payment_processor',
      entity_id: ENTITY_ID,
    });

    const paramsA = (withTenantQuery as any).mock.calls[0][1];
    const paramsB = (withTenantQuery as any).mock.calls[1][1];
    expect(paramsA[4]).toBe('pass'); // status param
    expect(paramsB[4]).toBe('pass'); // identical status for a completely different entity_type
    expect(paramsA[5]).toBe(0.15);   // risk_score, hardcoded
    expect(paramsB[5]).toBe(0.15);
    // TODO(ai-compliance launch blocker): perform a real check against entity_type/policy_id.
  });

  it('blocks when the tier disables basicComplianceChecks', async () => {
    vi.resetModules();
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValueOnce(true);
    (fs.readFileSync as any).mockReturnValueOnce(
      JSON.stringify({ enabled: true, tiers: { basicComplianceChecks: false }, limits: {} })
    );
    const mod = await import('../index');
    await expect(
      mod.AiComplianceService.runComplianceCheck(TENANT_ID, { entity_type: 'x', entity_id: ENTITY_ID })
    ).rejects.toThrow('Compliance checks are blocked on current tier');
  });

  it('throws INTERNAL when the insert returns no rows', async () => {
    const AiComplianceService = await freshService();
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(
      AiComplianceService.runComplianceCheck(TENANT_ID, { entity_type: 'x', entity_id: ENTITY_ID, policy_id: POLICY_ID })
    ).rejects.toThrow('Failed to record compliance checks details');
  });
});

describe('generateAuditReport', () => {
  // KNOWN DEFECT — documented, not hidden.
  // risk_score and summary are fixed literals with no relationship to
  // reportType or any actual audit data.
  it('DEFECT: returns the same risk_score and summary text for any reportType', async () => {
    const AiComplianceService = await freshService();
    (withTenantQuery as any).mockResolvedValue([{ id: 'report-1' }]);

    await AiComplianceService.generateAuditReport(TENANT_ID, 'gdpr');
    await AiComplianceService.generateAuditReport(TENANT_ID, 'ccpa');

    const paramsGdpr = (withTenantQuery as any).mock.calls[0][1];
    const paramsCcpa = (withTenantQuery as any).mock.calls[1][1];
    expect(paramsGdpr[2]).toBe(paramsCcpa[2]); // identical summary text
    expect(paramsGdpr[3]).toBe(0.85);
    expect(paramsCcpa[3]).toBe(0.85);
    // TODO(ai-compliance launch blocker): generate real findings/risk_score per reportType.
  });

  it('blocks when the tier disables auditReports', async () => {
    vi.resetModules();
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValueOnce(true);
    (fs.readFileSync as any).mockReturnValueOnce(
      JSON.stringify({ enabled: true, tiers: { auditReports: false }, limits: {} })
    );
    const mod = await import('../index');
    await expect(mod.AiComplianceService.generateAuditReport(TENANT_ID, 'gdpr')).rejects.toThrow(
      'Compliance audit snapshots are blocked on current tier'
    );
  });
});

describe('fetchReports', () => {
  it('returns whatever rows the query yields', async () => {
    const AiComplianceService = await freshService();
    const rows = [{ id: 'r1' }, { id: 'r2' }];
    (withTenantQuery as any).mockResolvedValueOnce(rows);
    const result = await AiComplianceService.fetchReports(TENANT_ID);
    expect(result).toEqual(rows);
  });
});
