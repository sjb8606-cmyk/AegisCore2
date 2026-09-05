/**
 * @platform/deprecation-manager
 * Hard cutoff → GONE; grace window → warning; pre-deprecate → allow.
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND', GONE: 'GONE' },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  createDeprecationRule, logUsageEvent, evaluateEnforcementGate, getDeprecationLedger,
  AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const RULE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('deprecation-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createDeprecationRule FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({ enabled: false, tiers: {} }));
    await expect(createDeprecationRule(TENANT, {
      surface_name: '/v1/legacy',
      deprecated_at: '2025-01-01T00:00:00.000Z',
      hard_cutoff_at: '2025-06-01T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('createDeprecationRule inserts rule', async () => {
    const row = { id: RULE, surface_name: '/v1/legacy' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createDeprecationRule(TENANT, {
      surface_name: '/v1/legacy',
      deprecated_at: '2025-01-01T00:00:00.000Z',
      hard_cutoff_at: '2026-12-01T00:00:00.000Z',
      grace_days_override: 7,
    });
    expect(result).toEqual(row);
  });

  it('logUsageEvent BAD_REQUEST on invalid rule id', async () => {
    await expect(logUsageEvent(TENANT, 'bad', 'fp-1', 100))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('logUsageEvent inserts usage event', async () => {
    const row = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await logUsageEvent(TENANT, RULE, 'fp-1', 128);
    expect(result).toEqual(row);
  });

  it('evaluateEnforcementGate allows when no rule', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    expect(await evaluateEnforcementGate(TENANT, '/v1/ok')).toEqual({ allowed: true });
  });

  it('evaluateEnforcementGate throws GONE past hard cutoff + grace', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{
      deprecated_at: '2020-01-01T00:00:00.000Z',
      hard_cutoff_at: '2020-06-01T00:00:00.000Z',
      grace_days_override: 0,
      migration_guide_url: 'https://docs.example/migrate',
    }]);
    await expect(evaluateEnforcementGate(TENANT, '/v1/legacy'))
      .rejects.toMatchObject({ code: 'GONE', message: expect.stringMatching(/fully deprecated/i) });
  });

  it('evaluateEnforcementGate returns warning in grace window', async () => {
    // deprecated in the past, cutoff far in the future
    mockWithTenantQuery.mockResolvedValueOnce([{
      deprecated_at: '2020-01-01T00:00:00.000Z',
      hard_cutoff_at: '2099-01-01T00:00:00.000Z',
      grace_days_override: 0,
      migration_guide_url: 'https://docs.example/migrate',
    }]);
    const result = await evaluateEnforcementGate(TENANT, '/v1/legacy');
    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.migration_guide_url).toBe('https://docs.example/migrate');
  });

  it('getDeprecationLedger NOT_FOUND / success with usage history', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getDeprecationLedger(TENANT, RULE)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const rule = { id: RULE, surface_name: '/v1/legacy' };
    const events = [{ id: 'e1' }];
    mockWithTenantQuery.mockResolvedValueOnce([rule]).mockResolvedValueOnce(events);
    const result = await getDeprecationLedger(TENANT, RULE);
    expect(result.usage_history).toEqual(events);
  });
});
