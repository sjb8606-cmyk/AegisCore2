/**
 * @platform/feature-flags
 * Real percentage rollout via SHA-256 of flagKey:identifier; override > rules > default.
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND' },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import { createFlag, evaluateFlag, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const FLAG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('feature-flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createFlag FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({ enabled: false }));
    await expect(createFlag(TENANT, {
      key: 'new-ui', name: 'New UI', flag_type: 'boolean', default_value: false,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('createFlag inserts flag with JSON default_value', async () => {
    const row = { id: FLAG, key: 'new-ui', status: 'active' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createFlag(TENANT, {
      key: 'new-ui', name: 'New UI', flag_type: 'boolean', default_value: false,
    });
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[0][1][6]).toBe(JSON.stringify(false));
  });

  it('evaluateFlag NOT_FOUND when key missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(evaluateFlag(TENANT, {
      tenantId: TENANT, flag_key: 'missing',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('evaluateFlag returns default when killed', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{
      id: FLAG, key: 'x', status: 'killed', default_value: JSON.stringify(false),
    }]);
    const result = await evaluateFlag(TENANT, { tenantId: TENANT, flag_key: 'x' });
    expect(result).toEqual({ value: false, reason: 'flag_disabled' });
  });

  it('evaluateFlag prefers user override', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        id: FLAG, key: 'x', status: 'active', default_value: JSON.stringify(false),
      }])
      .mockResolvedValueOnce([{ value: JSON.stringify(true) }]); // override
    const result = await evaluateFlag(TENANT, {
      tenantId: TENANT, flag_key: 'x', userId: USER,
    });
    expect(result).toEqual({ value: true, reason: 'user_override' });
  });

  it('evaluateFlag matches percentage_rollout when hash in bucket', async () => {
    // force 100% rollout so match is guaranteed
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        id: FLAG, key: 'roll', status: 'active', default_value: JSON.stringify('off'),
      }])
      .mockResolvedValueOnce([]) // no user override
      .mockResolvedValueOnce([{
        rule_type: 'percentage_rollout',
        active: true,
        priority: 1,
        rule_config: JSON.stringify({ rolloutPercentage: 100 }),
        return_value: JSON.stringify('on'),
      }]);
    const result = await evaluateFlag(TENANT, {
      tenantId: TENANT, flag_key: 'roll', userId: USER,
    });
    expect(result).toEqual({ value: 'on', reason: 'percentage_rollout_match' });
  });

  it('evaluateFlag falls back to default when no rules match', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        id: FLAG, key: 'y', status: 'active', default_value: JSON.stringify(42),
      }])
      .mockResolvedValueOnce([]) // no override
      .mockResolvedValueOnce([]); // no rules
    const result = await evaluateFlag(TENANT, { tenantId: TENANT, flag_key: 'y' });
    expect(result).toEqual({ value: 42, reason: 'default_fallback' });
  });
});
