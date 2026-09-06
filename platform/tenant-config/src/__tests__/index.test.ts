/**
 * @platform/tenant-config
 * Schema type enforcement + version increment + history ledger.
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
  createNamespace, registerSchemaKey, setConfigValue, getNamespaceLedger, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const NS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CFG = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('tenant-config', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('createNamespace FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({ enabled: false, tiers: {} }));
    await expect(createNamespace(TENANT, { name: 'billing' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('createNamespace inserts and returns row', async () => {
    const row = { id: NS, name: 'billing' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createNamespace(TENANT, { name: 'billing', description: 'Billing knobs' });
    expect(result).toEqual(row);
  });

  it('registerSchemaKey FORBIDDEN when schemaValidation tier off', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: true, tiers: { schemaValidation: false, configStorage: true, versionHistory: true },
    }));
    await expect(registerSchemaKey(TENANT, {
      namespace_id: NS, config_key: 'max_seats', value_type: 'number',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('registerSchemaKey inserts schema row', async () => {
    const row = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', config_key: 'max_seats', value_type: 'number' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await registerSchemaKey(TENANT, {
      namespace_id: NS, config_key: 'max_seats', value_type: 'number', required: true,
    });
    expect(result).toEqual(row);
  });

  it('setConfigValue BAD_REQUEST on number schema mismatch', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ value_type: 'number', config_key: 'max_seats' }]);
    await expect(setConfigValue(TENANT, {
      namespace_id: NS, config_key: 'max_seats', config_value: 'not-a-number',
    }, USER)).rejects.toMatchObject({
      code: 'BAD_REQUEST', message: expect.stringMatching(/Schema Type Mismatch/i),
    });
  });

  it('setConfigValue BAD_REQUEST on boolean schema mismatch', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ value_type: 'boolean', config_key: 'feature_x' }]);
    await expect(setConfigValue(TENANT, {
      namespace_id: NS, config_key: 'feature_x', config_value: 'yes',
    }, USER)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('setConfigValue inserts new key at version 1 with history', async () => {
    const row = { id: CFG, config_key: 'theme', config_value: 'dark', version: 1 };
    mockWithTenantQuery
      .mockResolvedValueOnce([])          // no schema
      .mockResolvedValueOnce([])          // no existing
      .mockResolvedValueOnce([row])       // insert
      .mockResolvedValueOnce([]);         // history
    const result = await setConfigValue(TENANT, {
      namespace_id: NS, config_key: 'theme', config_value: 'dark',
    }, USER);
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls.some((c) => /tenant_config_history/i.test(String(c[0])))).toBe(true);
  });

  it('setConfigValue increments version on update', async () => {
    const existing = { id: CFG, config_key: 'theme', config_value: 'light', version: '2' };
    const updated = { ...existing, config_value: 'dark', version: 3 };
    mockWithTenantQuery
      .mockResolvedValueOnce([])            // no schema
      .mockResolvedValueOnce([existing])    // existing
      .mockResolvedValueOnce([updated])     // update
      .mockResolvedValueOnce([]);           // history
    const result = await setConfigValue(TENANT, {
      namespace_id: NS, config_key: 'theme', config_value: 'dark',
    }, USER);
    expect(result.version).toBe(3);
    expect(mockWithTenantQuery.mock.calls[2][1][1]).toBe(3); // nextVersion
  });

  it('getNamespaceLedger NOT_FOUND / success with nested history', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getNamespaceLedger(TENANT, NS)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const ns = { id: NS, name: 'billing' };
    const configs = [{ id: CFG, config_key: 'theme', config_value: 'dark' }];
    const history = [{ version: 1, new_value: 'dark' }];
    mockWithTenantQuery
      .mockResolvedValueOnce([ns])
      .mockResolvedValueOnce(configs)
      .mockResolvedValueOnce(history);
    const result = await getNamespaceLedger(TENANT, NS);
    expect(result.id).toBe(NS);
    expect(result.configurations[0].version_history).toEqual(history);
  });
});
