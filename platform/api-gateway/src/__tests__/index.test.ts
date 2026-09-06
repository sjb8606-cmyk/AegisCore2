import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { createApiKey, validateApiKey, logRequest } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as crypto from 'crypto';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createApiKey', () => {
  it('blocks when the vertical is disabled', async () => {
    mockConfig({ enabled: false, tiers: {}, limits: { apiKeyCount: 5 } });
    await expect(createApiKey(TENANT_ID, USER_ID, { name: 'key1' })).rejects.toThrow(
      'API Gateway vertical is disabled'
    );
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('enforces the active key count limit before generating a new key', async () => {
    mockConfig({ enabled: true, tiers: {}, limits: { apiKeyCount: 2 } });
    (withTenantQuery as any).mockResolvedValueOnce([{ count: '2' }]);
    await expect(createApiKey(TENANT_ID, USER_ID, { name: 'key3' })).rejects.toThrow(
      'API Key capacity limits reached'
    );
    expect(withTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('returns the raw key only once, alongside the stored (hashed) record', async () => {
    mockConfig({ enabled: true, tiers: {}, limits: { apiKeyCount: 5, requestsPerMinute: 60 } });
    const storedRecord = { id: 'key-1', name: 'key1', key_hash: 'somehash' };
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([storedRecord]);

    const result = await createApiKey(TENANT_ID, USER_ID, { name: 'key1' });

    expect(result.record).toEqual(storedRecord);
    expect(result.key).toMatch(/^rtk_(test|live)_[0-9a-f]{48}$/);

    const insertParams = (withTenantQuery as any).mock.calls[1][1];
    const storedHash = insertParams[3];
    expect(storedHash).not.toBe(result.key);
    expect(storedHash).toBe(crypto.createHash('sha256').update(result.key).digest('hex'));
  });

  it('defaults scopes to ["read"] and ipWhitelist to [] when not provided', async () => {
    mockConfig({ enabled: true, tiers: {}, limits: { apiKeyCount: 5, requestsPerMinute: 60 } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ id: 'key-1' }]);

    await createApiKey(TENANT_ID, USER_ID, { name: 'key1' });

    const insertParams = (withTenantQuery as any).mock.calls[1][1];
    expect(insertParams[5]).toEqual(['read']);
    expect(insertParams[6]).toEqual([]);
  });
});

describe('validateApiKey', () => {
  it('returns valid: false when no matching active, unexpired key exists', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    const result = await validateApiKey(TENANT_ID, 'rtk_test_somekey');
    expect(result).toEqual({ valid: false });
  });

  it('returns valid: true with scopes when the key matches', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'key-1', scopes: ['read', 'write'] }]);
    const result = await validateApiKey(TENANT_ID, 'rtk_test_somekey');
    expect(result).toEqual({ valid: true, keyId: 'key-1', scopes: ['read', 'write'] });
  });

  it('looks up by the SHA-256 hash of the raw key, never the raw key itself', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await validateApiKey(TENANT_ID, 'rtk_test_abc123');
    const queryParams = (withTenantQuery as any).mock.calls[0][1];
    expect(queryParams[0]).toBe(crypto.createHash('sha256').update('rtk_test_abc123').digest('hex'));
  });

  // GAP — documented, not hidden.
  // The api_keys table has an ip_whitelist column and ipWhitelisting is a
  // configured tier, but validateApiKey() takes no caller IP argument and
  // never checks one against the stored whitelist. A key with a restrictive
  // ip_whitelist set is validated exactly the same as one with none.
  it('GAP: does not accept or check a caller IP against ip_whitelist at all', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'key-1', scopes: ['read'], ip_whitelist: ['10.0.0.1'] }]);
    const result = await validateApiKey(TENANT_ID, 'rtk_test_somekey');
    expect(result.valid).toBe(true);
    // TODO(api-gateway): validateApiKey needs a callerIp param and an actual
    // whitelist check before ipWhitelisting is a real, enforced feature.
  });
});

describe('logRequest', () => {
  it('records a request log row and returns it', async () => {
    const row = { id: 'req-1', method: 'GET', path: '/v1/users', status_code: 200 };
    (withTenantQuery as any).mockResolvedValueOnce([row]);

    const result = await logRequest(TENANT_ID, 'key-1', {
      method: 'GET',
      path: '/v1/users',
      statusCode: 200,
      durationMs: 42,
    });

    expect(result).toEqual(row);
    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[2]).toBe('key-1');
    expect(params[3]).toBe('GET');
  });

  it('allows a null keyId for unauthenticated/failed-auth requests', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'req-2' }]);
    await logRequest(TENANT_ID, null, { method: 'GET', path: '/v1/x', statusCode: 401, durationMs: 5 });
    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[2]).toBeNull();
  });
});
