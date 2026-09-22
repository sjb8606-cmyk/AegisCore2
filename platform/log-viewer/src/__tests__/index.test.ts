import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockGetTierConfig = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/entitlements', () => ({
  getTierConfig: (...args: unknown[]) => mockGetTierConfig(...args),
}));

vi.mock('@platform/utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@platform/utils');
  return { ...actual };
});

import { ingestLog, queryLogs, exportLogs } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';

function defaultTier(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      queryLogs: true,
      filterByActor: true,
      filterByAction: true,
      exportLogs: true,
      retentionPolicy: true,
      ...(over.tiers as object),
    },
    limits: {
      maxPageSize: 100,
      defaultPageSize: 25,
      maxExportRows: 5000,
      ...(over.limits as object),
    },
  };
}

beforeEach(() => {
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('ingestLog', () => {
  it('inserts a log event', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { id: 'log-1', action: 'user.login', outcome: 'success' },
    ]);
    const row = await ingestLog(TENANT, { action: 'user.login', actor_id: ACTOR });
    expect(row.action).toBe('user.login');
  });

  it('rejects empty action', async () => {
    await expect(ingestLog(TENANT, { action: '' })).rejects.toThrow();
  });

  it('throws FORBIDDEN when disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    await expect(ingestLog(TENANT, { action: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid tenant id', async () => {
    await expect(ingestLog('bad', { action: 'x' })).rejects.toMatchObject({
      message: expect.stringMatching(/invalid tenant/i),
    });
  });
});

describe('queryLogs', () => {
  it('returns paginated results', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: 'log-1', action: 'user.login' }])
      .mockResolvedValueOnce([{ total: 1 }]);
    const result = await queryLogs(TENANT, { page: 1, page_size: 25 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it('requires filterByActor tier when filtering by actor', async () => {
    mockGetTierConfig.mockResolvedValue(defaultTier({ tiers: { filterByActor: false } }));
    await expect(
      queryLogs(TENANT, { actor_id: ACTOR }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('exportLogs', () => {
  it('exports rows', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: 'log-1' }, { id: 'log-2' }])
      .mockResolvedValueOnce([{ total: 2 }]);
    const result = await exportLogs(TENANT, {});
    expect(result.count).toBe(2);
    expect(result.exported_at).toBeTruthy();
  });

  it('throws FORBIDDEN when exportLogs tier off', async () => {
    mockGetTierConfig.mockResolvedValue(defaultTier({ tiers: { exportLogs: false } }));
    await expect(exportLogs(TENANT, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
