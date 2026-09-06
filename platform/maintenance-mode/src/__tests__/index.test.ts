import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSyncMock = vi.fn();
  const readFileSyncMock = vi.fn();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    default: { ...actual, existsSync: existsSyncMock, readFileSync: readFileSyncMock },
  };
});

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

// @platform/utils (AppError/ErrorCode/parseUserId/isValidUuid) is real.

import { withTenantQuery } from '@platform/tenancy';
import { ErrorCode } from '@platform/utils';
import {
  createMaintenanceWindow,
  addBypassEntry,
  evaluateRequestGate,
  getMaintenanceLedger,
} from '../index';

const mockedWithTenantQuery = withTenantQuery as unknown as ReturnType<typeof vi.fn>;

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const windowId = '33333333-3333-3333-3333-333333333333';

const DEFAULT_CONFIG = { enabled: true, tiers: { requestGating: true, bypassAllowlist: true } };

function mockConfig(cfg: unknown) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

/**
 * BUG (systemic, checked at every throw site below): every AppError in
 * this file is constructed with a raw string literal ('FORBIDDEN',
 * 'BAD_REQUEST', 'NOT_FOUND', 'SERVICE_UNAVAILABLE') instead of the
 * imported ErrorCode enum member -- `ErrorCode.` never appears anywhere
 * in this file's logic despite being imported and re-exported. This
 * happens to work at runtime because TypeScript string enums share their
 * literal string value with the bare string, but a real `tsc` build
 * (nominal enum typing) would very likely reject a bare string literal
 * where an ErrorCode-typed parameter is expected -- even though it
 * passes esbuild/vitest's transpile-only type-erasure. Each test below
 * that checks `.code`/`.statusCode` is confirming the runtime coincidence
 * still functionally works, not that the file is written correctly.
 */

describe('createMaintenanceWindow', () => {
  it('creates a tenant-scoped window', async () => {
    mockConfig(DEFAULT_CONFIG);
    const insertedRow = { id: windowId, tenant_id: tenantId, scope: 'tenant', status: 'scheduled' };
    mockedWithTenantQuery.mockResolvedValueOnce([insertedRow]);

    const result = await createMaintenanceWindow(tenantId, {
      scope: 'tenant',
      title: 'DB upgrade',
      starts_at: '2026-01-01T00:00:00.000Z',
      ends_at: '2026-01-01T01:00:00.000Z',
    });

    expect(result).toEqual(insertedRow);
    const [, params] = mockedWithTenantQuery.mock.calls[0];
    expect(params[1]).toBe(tenantId); // targetTenant
    expect(params[5]).toBe('scheduled'); // default status
  });

  it('forces tenant_id to null for platform-scoped windows', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery.mockResolvedValueOnce([{ id: windowId, scope: 'platform' }]);

    await createMaintenanceWindow(tenantId, {
      scope: 'platform',
      title: 'Platform-wide upgrade',
      starts_at: '2026-01-01T00:00:00.000Z',
      ends_at: '2026-01-01T01:00:00.000Z',
    });

    const [, params] = mockedWithTenantQuery.mock.calls[0];
    expect(params[1]).toBeNull();
  });

  it('BUG: no authorization check prevents any tenant from creating a platform-wide, immediately-active window', async () => {
    mockConfig(DEFAULT_CONFIG);
    const insertedRow = { id: windowId, scope: 'platform', status: 'active' };
    mockedWithTenantQuery.mockResolvedValueOnce([insertedRow]);

    // Real fix: require and check a platform-admin role/permission before
    // allowing scope: 'platform' (especially combined with status:
    // 'active'). Today, any caller with any tenantId can immediately
    // take down platform-wide request access via evaluateRequestGate's
    // `scope = 'platform'` check. There's not even an actor/role
    // parameter on this function to check against.
    expect(createMaintenanceWindow.length).toBe(2); // (tenantId, data) -- no role/actor param
    const result = await createMaintenanceWindow(tenantId, {
      scope: 'platform',
      title: 'Emergency migration',
      starts_at: '2026-01-01T00:00:00.000Z',
      ends_at: '2026-01-01T01:00:00.000Z',
      status: 'active',
    });
    expect(result).toEqual(insertedRow);
  });

  it('throws FORBIDDEN (via a bare string literal, not ErrorCode.FORBIDDEN) when disabled', async () => {
    mockConfig({ ...DEFAULT_CONFIG, enabled: false });
    try {
      await createMaintenanceWindow(tenantId, {
        scope: 'tenant',
        title: 'X',
        starts_at: '2026-01-01T00:00:00.000Z',
        ends_at: '2026-01-01T01:00:00.000Z',
      });
      throw new Error('expected to throw');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.FORBIDDEN); // happens to work -- see comment above
      expect(err.statusCode).toBe(403);
    }
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects invalid schema input via zod', async () => {
    mockConfig(DEFAULT_CONFIG);
    await expect(
      createMaintenanceWindow(tenantId, { scope: 'tenant', title: 'X', starts_at: 'not-a-date', ends_at: 'not-a-date' }),
    ).rejects.toThrow();
  });
});

describe('addBypassEntry', () => {
  it('adds a bypass entry', async () => {
    const insertedRow = { id: 'bypass-1', window_id: windowId, bypass_type: 'user_id', bypass_value: userId };
    mockedWithTenantQuery.mockResolvedValueOnce([insertedRow]);

    const result = await addBypassEntry(tenantId, windowId, { bypass_type: 'user_id', bypass_value: userId });

    expect(result).toEqual(insertedRow);
  });

  it('rejects an invalid windowId format with BAD_REQUEST', async () => {
    try {
      await addBypassEntry(tenantId, 'not-a-uuid', { bypass_type: 'ip', bypass_value: '1.2.3.4' });
      throw new Error('expected to throw');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.BAD_REQUEST);
      expect(err.statusCode).toBe(400);
    }
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('BUG: never checks cfg.enabled -- bypass entries can be added even while maintenance-mode is globally disabled', async () => {
    // addBypassEntry never calls loadConfig() at all, unlike
    // createMaintenanceWindow/evaluateRequestGate. Real fix: load config
    // here too and check cfg.enabled.
    mockConfig({ ...DEFAULT_CONFIG, enabled: false });
    mockedWithTenantQuery.mockResolvedValueOnce([{ id: 'bypass-2' }]);

    await expect(
      addBypassEntry(tenantId, windowId, { bypass_type: 'ip', bypass_value: '1.2.3.4' }),
    ).resolves.toEqual({ id: 'bypass-2' });
  });

  it('rejects invalid bypass data via zod', async () => {
    await expect(
      addBypassEntry(tenantId, windowId, { bypass_type: 'invalid-type', bypass_value: 'x' } as any),
    ).rejects.toThrow();
  });
});

describe('evaluateRequestGate', () => {
  it('allows the request when the module is globally disabled, without querying anything', async () => {
    mockConfig({ ...DEFAULT_CONFIG, enabled: false });
    const result = await evaluateRequestGate(tenantId, userId, 'member', '1.2.3.4');
    expect(result).toEqual({ allowed: true });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('allows the request when the requestGating tier is disabled, without querying anything', async () => {
    mockConfig({ ...DEFAULT_CONFIG, tiers: { ...DEFAULT_CONFIG.tiers, requestGating: false } });
    const result = await evaluateRequestGate(tenantId, userId, 'member', '1.2.3.4');
    expect(result).toEqual({ allowed: true });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('allows the request when there is no active maintenance window', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery.mockResolvedValueOnce([]);
    const result = await evaluateRequestGate(tenantId, userId, 'member', '1.2.3.4');
    expect(result).toEqual({ allowed: true });
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('skips the bypass check entirely and blocks when bypassAllowlist tier is disabled', async () => {
    mockConfig({ ...DEFAULT_CONFIG, tiers: { ...DEFAULT_CONFIG.tiers, bypassAllowlist: false } });
    mockedWithTenantQuery.mockResolvedValueOnce([{ id: windowId, title: 'DB upgrade', scope: 'tenant' }]);

    try {
      await evaluateRequestGate(tenantId, userId, 'member', '1.2.3.4');
      throw new Error('expected to throw');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(err.statusCode).toBe(503);
      expect(err.message).toContain('DB upgrade');
    }
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(1); // bypass query never attempted
  });

  it('allows and reports bypass when a bypass entry matches by user_id', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ id: windowId, title: 'DB upgrade', scope: 'tenant' }])
      .mockResolvedValueOnce([{ id: 'bypass-1', bypass_type: 'user_id', bypass_value: userId }]);

    const result = await evaluateRequestGate(tenantId, userId, 'member', '1.2.3.4');
    expect(result).toEqual({
      allowed: true,
      bypassed: true,
      reason: 'Bypass authorized via match of rule type: user_id',
    });
  });

  it('blocks with SERVICE_UNAVAILABLE when no bypass entry matches', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ id: windowId, title: 'DB upgrade', scope: 'tenant' }])
      .mockResolvedValueOnce([]);

    try {
      await evaluateRequestGate(tenantId, userId, 'member', '1.2.3.4');
      throw new Error('expected to throw');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(err.statusCode).toBe(503);
      expect(err.message).toContain('DB upgrade');
    }
  });

  it('GAP: userId is never validated -- an empty/garbage value still flows straight into the bypass query', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ id: windowId, title: 'DB upgrade', scope: 'tenant' }])
      .mockResolvedValueOnce([{ id: 'bypass-1', bypass_type: 'role', bypass_value: 'admin' }]);

    // Real fix: parseUserId is imported but never called here. This test
    // shows a completely invalid "userId" has no effect on the outcome --
    // it's just interpolated into the query as a raw, unchecked param.
    const result = await evaluateRequestGate(tenantId, '', 'admin', '1.2.3.4');
    expect(result.allowed).toBe(true);
    expect(result.bypassed).toBe(true);
  });
});

describe('getMaintenanceLedger', () => {
  it('returns the window merged with its bypass allowlist', async () => {
    const window = { id: windowId, tenant_id: tenantId, title: 'DB upgrade' };
    const bypassList = [{ id: 'bypass-1', bypass_type: 'ip', bypass_value: '1.2.3.4' }];
    mockedWithTenantQuery.mockResolvedValueOnce([window]).mockResolvedValueOnce(bypassList);

    const result = await getMaintenanceLedger(tenantId, windowId);

    expect(result).toEqual({ ...window, bypass_allowlist: bypassList });
  });

  it('rejects an invalid windowId format with BAD_REQUEST', async () => {
    try {
      await getMaintenanceLedger(tenantId, 'not-a-uuid');
      throw new Error('expected to throw');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.BAD_REQUEST);
      expect(err.statusCode).toBe(400);
    }
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the window does not exist', async () => {
    mockedWithTenantQuery.mockResolvedValueOnce([]);
    try {
      await getMaintenanceLedger(tenantId, windowId);
      throw new Error('expected to throw');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.NOT_FOUND);
      expect(err.statusCode).toBe(404);
    }
  });
});
