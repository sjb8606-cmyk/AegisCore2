import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockEncryptField = vi.fn();
const mockDecryptField = vi.fn();
const mockFsExists = vi.fn();
const mockFsRead = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));

vi.mock('../../../security/src/kms', () => ({
  encryptField: (...a: unknown[]) => mockEncryptField(...a),
  decryptField: (...a: unknown[]) => mockDecryptField(...a),
}));

vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockFsExists(...a),
  readFileSync: (...a: unknown[]) => mockFsRead(...a),
}));

import {
  startOAuthFlow,
  handleOAuthCallback,
  triggerSync,
  getSyncLogs,
  kmsEncrypt,
  kmsDecrypt,
} from '../index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CONNECTION_ID = '33333333-3333-3333-3333-333333333333';

function mockConfig(cfg: any) {
  mockFsExists.mockReturnValue(true);
  mockFsRead.mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig({
    enabled: true,
    tiers: { googleWorkspace: true, slack: true },
    limits: { connectorCount: 5 },
  });
  mockEncryptField.mockResolvedValue('encrypted');
  mockDecryptField.mockResolvedValue('decrypted-token');
});

describe('startOAuthFlow', () => {
  it('throws when integrations are disabled', async () => {
    mockConfig({ enabled: false, tiers: {}, limits: { connectorCount: 5 } });
    await expect(startOAuthFlow(TENANT_ID, 'googleWorkspace', USER_ID)).rejects.toThrow(
      'Integrations disabled'
    );
  });

  it('returns authUrl and state when enabled', async () => {
    const result = await startOAuthFlow(TENANT_ID, 'googleWorkspace', USER_ID);
    expect(result.authUrl).toContain('accounts.google.com');
    expect(result.state).toBeTruthy();
  });
});

describe('handleOAuthCallback', () => {
  it('throws NOT_IMPLEMENTED instead of storing mock tokens', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ count: 0 }]);
    await expect(
      handleOAuthCallback(TENANT_ID, 'googleWorkspace', 'auth-code', 'state', USER_ID)
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});

describe('triggerSync', () => {
  it('throws NOT_FOUND when connection does not exist', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(triggerSync(TENANT_ID, CONNECTION_ID)).rejects.toThrow('Connection not found');
  });
});

describe('getSyncLogs', () => {
  it('returns the rows exactly as the tenant-scoped query returns them', async () => {
    const rows = [{ id: 'log-1', status: 'success' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const result = await getSyncLogs(TENANT_ID, CONNECTION_ID);
    expect(result).toEqual(rows);
  });

  it('returns an empty array when there are no sync logs', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const result = await getSyncLogs(TENANT_ID, CONNECTION_ID);
    expect(result).toEqual([]);
  });
});

describe('kmsEncrypt / kmsDecrypt', () => {
  it('delegate to the real KMS envelope helpers in platform/security', async () => {
    await kmsEncrypt('plain');
    await kmsDecrypt('cipher');
    expect(mockEncryptField).toHaveBeenCalledWith('plain');
    expect(mockDecryptField).toHaveBeenCalledWith('cipher');
  });
});
