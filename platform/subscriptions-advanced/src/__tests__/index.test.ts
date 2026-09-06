/**
 * @platform/subscriptions-advanced
 * Real entitlement remaining math; overage throws PAYMENT_REQUIRED.
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
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  createPlan, createSubscription, recordUsage, getEntitlementStatus, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const PLAN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SUB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('subscriptions-advanced', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('createPlan FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({ enabled: false, tiers: {} }));
    await expect(createPlan(TENANT, { name: 'Pro', price_cents: 2900 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('createPlan inserts plan and entitlements', async () => {
    const plan = { id: PLAN, name: 'Pro', price_cents: 2900, interval: 'month' };
    mockWithTenantQuery
      .mockResolvedValueOnce([plan])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await createPlan(TENANT, {
      name: 'Pro', price_cents: 2900, interval: 'month',
      entitlements: [
        { metric: 'api_calls', limit_quantity: 10000 },
        { metric: 'seats', limit_quantity: 5 },
      ],
    });
    expect(result).toEqual(plan);
    expect(mockWithTenantQuery.mock.calls.filter((c) => /saas_entitlements/i.test(String(c[0])))).toHaveLength(2);
  });

  it('createSubscription BAD_REQUEST on invalid plan UUID', async () => {
    await expect(createSubscription(TENANT, USER, 'not-uuid'))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('createSubscription inserts active sub with 30-day period end', async () => {
    const row = { id: SUB, plan_id: PLAN, status: 'active' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createSubscription(TENANT, USER, PLAN);
    expect(result).toEqual(row);
    const end = mockWithTenantQuery.mock.calls[0][1][4];
    expect(new Date(end).getTime()).toBeGreaterThan(Date.now());
  });

  it('getEntitlementStatus returns zeros when no entitlement row', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const status = await getEntitlementStatus(TENANT, SUB, 'api_calls');
    expect(status).toEqual({ metric: 'api_calls', limit: 0, used: 0, remaining: 0, allowed: false });
  });

  it('getEntitlementStatus computes remaining correctly', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        limit_quantity: '1000',
        current_period_start: '2026-01-01',
        current_period_end: '2026-02-01',
      }])
      .mockResolvedValueOnce([{ total_used: '250' }]);
    const status = await getEntitlementStatus(TENANT, SUB, 'api_calls');
    expect(status).toEqual({
      metric: 'api_calls', limit: 1000, used: 250, remaining: 750, allowed: true,
    });
  });

  it('recordUsage PAYMENT_REQUIRED when overage', async () => {
    // getEntitlementStatus path inside recordUsage
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        limit_quantity: '100',
        current_period_start: '2026-01-01',
        current_period_end: '2026-02-01',
      }])
      .mockResolvedValueOnce([{ total_used: '95' }]);
    await expect(recordUsage(TENANT, SUB, { metric: 'api_calls', quantity: 10 }, USER))
      .rejects.toMatchObject({ code: 'PAYMENT_REQUIRED', message: expect.stringMatching(/Overage blocked/i) });
  });

  it('recordUsage inserts usage when within limit', async () => {
    const row = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', metric: 'api_calls', quantity: 5 };
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        limit_quantity: '100',
        current_period_start: '2026-01-01',
        current_period_end: '2026-02-01',
      }])
      .mockResolvedValueOnce([{ total_used: '10' }])
      .mockResolvedValueOnce([row]);
    const result = await recordUsage(TENANT, SUB, { metric: 'api_calls', quantity: 5 }, USER);
    expect(result).toEqual(row);
  });
});
