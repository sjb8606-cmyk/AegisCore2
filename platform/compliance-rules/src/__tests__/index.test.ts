import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn() };
});

import { createRuleVersion, evaluateAsOf } from '../index';
import { withTenantQuery, withTenant } from '@platform/tenancy';
import { loadConfig } from '@platform/utils';
import { GENESIS_HASH } from '@platform/hash-chain';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';

const mockClient = { query: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, limits: { rulesPerMonth: 100 } });
  (withTenantQuery as any).mockResolvedValue([{ count: '0' }]);
  (withTenant as any).mockImplementation((_tenantId: string, fn: any) => fn(mockClient));
});

describe('createRuleVersion — real crud-kernel + quota-guard + hash-chain, working together', () => {
  it('creates a brand-new rule and its first version, chained from GENESIS_HASH', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'rule-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1', version_number: 1, hash: 'somehash' }] });

    await createRuleVersion(TENANT_ID, ACTOR_ID, {
      ruleKey: 'pesticide_phi_lockout',
      name: 'Pesticide PHI Lockout',
      effectiveDate: '2024-01-01',
      definition: [{ field: 'daysSinceApplication', operator: 'gte', value: 7 }],
    });

    const insertVersionCall = mockClient.query.mock.calls[3];
    expect(insertVersionCall[0]).toContain('INSERT INTO compliance_rule_versions');
    expect(insertVersionCall[1]).toContain(GENESIS_HASH);
    expect(insertVersionCall[1]).toContain(1);
  });

  it('chains a second version to the first rather than creating a duplicate rule', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'rule-1' }] })
      .mockResolvedValueOnce({ rows: [{ version_number: 1, hash: 'first-version-hash' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'version-2', version_number: 2 }] });

    await createRuleVersion(TENANT_ID, ACTOR_ID, {
      ruleKey: 'pesticide_phi_lockout',
      name: 'Pesticide PHI Lockout',
      effectiveDate: '2025-06-01',
      definition: [{ field: 'daysSinceApplication', operator: 'gte', value: 10 }],
    });

    const insertRuleCall = mockClient.query.mock.calls.find((c: any[]) => c[0].includes('INSERT INTO compliance_rules'));
    expect(insertRuleCall).toBeUndefined();

    const insertVersionCall = mockClient.query.mock.calls[2];
    expect(insertVersionCall[1]).toContain('first-version-hash');
    expect(insertVersionCall[1]).toContain(2);
  });

  it('blocks creation once the monthly quota is reached', async () => {
    (withTenantQuery as any).mockResolvedValue([{ count: '100' }]);

    await expect(
      createRuleVersion(TENANT_ID, ACTOR_ID, {
        ruleKey: 'x', name: 'x', effectiveDate: '2025-01-01', definition: [],
      }),
    ).rejects.toThrow('Monthly compliance rule version limit reached');
  });
});

describe('evaluateAsOf — the actual point of a VERSIONED rule engine', () => {
  it('uses the rule version that was really effective on the given date, not just the latest one', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: 'rule-1' }])
      .mockResolvedValueOnce([{
        version_number: 1,
        effective_date: '2024-01-01',
        definition: JSON.stringify([{ field: 'daysSinceApplication', operator: 'gte', value: 7 }]),
      }]);

    const result = await evaluateAsOf(TENANT_ID, 'pesticide_phi_lockout', '2024-06-15', { daysSinceApplication: 8 });

    expect(result.versionNumber).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('correctly fails an input that does not meet the rule condition', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: 'rule-1' }])
      .mockResolvedValueOnce([{
        version_number: 1,
        effective_date: '2024-01-01',
        definition: JSON.stringify([{ field: 'daysSinceApplication', operator: 'gte', value: 7 }]),
      }]);

    const result = await evaluateAsOf(TENANT_ID, 'pesticide_phi_lockout', '2024-06-15', { daysSinceApplication: 3 });

    expect(result.passed).toBe(false);
    expect(result.failedConditions).toHaveLength(1);
  });

  it('throws if no rule with that key exists', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      evaluateAsOf(TENANT_ID, 'nonexistent_rule', '2025-01-01', {}),
    ).rejects.toThrow('No compliance rule found');
  });

  it('throws if no version was effective yet as of the given date', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: 'rule-1' }])
      .mockResolvedValueOnce([]);

    await expect(
      evaluateAsOf(TENANT_ID, 'pesticide_phi_lockout', '2020-01-01', {}),
    ).rejects.toThrow('No version of rule');
  });
});
