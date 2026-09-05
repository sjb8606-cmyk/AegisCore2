/**
 * @platform/data-residency
 * Real enforce gate: enforce throws, audit logs violation, disabled allows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN' },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  createRegion, setResidencyPolicy, enforceResidencyGate, getResidencyLedger, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

describe('data-residency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createRegion upserts region row', async () => {
    const row = { region_code: 'us-east-1', display_name: 'US East' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createRegion(TENANT, {
      region_code: 'us-east-1', display_name: 'US East', jurisdiction: 'US',
    });
    expect(result).toEqual(row);
  });

  it('setResidencyPolicy FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({ enabled: false, tiers: {} }));
    await expect(setResidencyPolicy(TENANT, {
      allowed_regions: ['us-east-1'], primary_region: 'us-east-1',
    }, USER)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('setResidencyPolicy upserts policy and writes history', async () => {
    const policy = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      allowed_regions: ['us-east-1', 'eu-west-1'],
      primary_region: 'us-east-1',
      enforcement_mode: 'enforce',
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([])          // no existing
      .mockResolvedValueOnce([policy])    // upsert
      .mockResolvedValueOnce([]);         // history
    const result = await setResidencyPolicy(TENANT, {
      allowed_regions: ['us-east-1', 'eu-west-1'],
      primary_region: 'us-east-1',
      enforcement_mode: 'enforce',
    }, USER);
    expect(result).toEqual(policy);
    expect(mockWithTenantQuery.mock.calls[2][0]).toMatch(/residency_policy_history/i);
  });

  it('enforceResidencyGate allows when no policy', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const result = await enforceResidencyGate(TENANT, 'ap-south-1');
    expect(result).toEqual({ allowed: true });
  });

  it('enforceResidencyGate FORBIDDEN in enforce mode for disallowed region', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{
      allowed_regions: ['us-east-1'],
      enforcement_mode: 'enforce',
    }]);
    await expect(enforceResidencyGate(TENANT, 'ap-south-1'))
      .rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringMatching(/Sovereign Compliance Block/i),
      });
  });

  it('enforceResidencyGate audit mode logs violation and allows', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        allowed_regions: ['us-east-1'],
        enforcement_mode: 'audit',
      }])
      .mockResolvedValueOnce([]); // recordViolation insert
    const result = await enforceResidencyGate(TENANT, 'ap-south-1');
    expect(result).toEqual({ allowed: true, audited_violation: true });
    expect(mockWithTenantQuery.mock.calls[1][0]).toMatch(/residency_violations/i);
  });

  it('getResidencyLedger returns policy + history + violations', async () => {
    const policy = { primary_region: 'us-east-1' };
    const history = [{ id: 'h1' }];
    const violations = [{ id: 'v1' }];
    mockWithTenantQuery
      .mockResolvedValueOnce([policy])
      .mockResolvedValueOnce(history)
      .mockResolvedValueOnce(violations);
    const result = await getResidencyLedger(TENANT);
    expect(result.active_policy).toEqual(policy);
    expect(result.history).toEqual(history);
    expect(result.violations).toEqual(violations);
  });
});
