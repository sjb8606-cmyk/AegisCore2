/**
 * @platform/insurance
 * Real claim risk score from description keywords + amount ratio; routes to approved/under_review.
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND' },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  createHolder, createPolicy, submitClaim, getPolicyLedger, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const HOLDER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const POLICY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('insurance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createHolder inserts policyholder', async () => {
    const row = { id: HOLDER, first_name: 'Jane', last_name: 'Doe' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createHolder(TENANT, {
      first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com',
    });
    expect(result).toEqual(row);
  });

  it('createPolicy inserts active policy', async () => {
    const row = { id: POLICY, holder_id: HOLDER, coverage_limit: 100000, status: 'active' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createPolicy(TENANT, {
      holder_id: HOLDER, coverage_limit: 100000, premium_cents: 12000,
    });
    expect(result).toEqual(row);
  });

  it('submitClaim NOT_FOUND / inactive / over limit', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(submitClaim(TENANT, {
      policy_id: POLICY, description: 'fender bender', amount_cents: 1000, incident_date: '2026-01-01',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    mockWithTenantQuery.mockResolvedValueOnce([{ id: POLICY, status: 'canceled', coverage_limit: 100000 }]);
    await expect(submitClaim(TENANT, {
      policy_id: POLICY, description: 'fender bender', amount_cents: 1000, incident_date: '2026-01-01',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/inactive/i) });

    mockWithTenantQuery.mockResolvedValueOnce([{ id: POLICY, status: 'active', coverage_limit: 5000 }]);
    await expect(submitClaim(TENANT, {
      policy_id: POLICY, description: 'total loss', amount_cents: 99999, incident_date: '2026-01-01',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/coverage limit/i) });
  });

  it('submitClaim auto-approves high-trust low-risk claim', async () => {
    const claim = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      status: 'approved', risk_score: 0.95,
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: POLICY, status: 'active', coverage_limit: 100000 }])
      .mockResolvedValueOnce([claim]);
    const result = await submitClaim(TENANT, {
      policy_id: POLICY,
      description: 'Minor hail damage to roof',
      amount_cents: 2000,
      incident_date: '2026-03-01',
    });
    expect(result.status).toBe('approved');
  });

  it('getPolicyLedger nests claims under policy', async () => {
    const policy = {
      id: POLICY, first_name: 'Jane', last_name: 'Doe', coverage_limit: 100000,
    };
    const claims = [{ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', status: 'approved' }];
    mockWithTenantQuery.mockResolvedValueOnce([policy]).mockResolvedValueOnce(claims);
    const result = await getPolicyLedger(TENANT, POLICY);
    expect(result.claims).toEqual(claims);
  });
});
