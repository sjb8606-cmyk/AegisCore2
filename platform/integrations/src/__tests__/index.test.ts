import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-boundary mocks ──────────────────────────────────────────────────

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

// Real path is platform/security/src/kms.ts -- mocked at the module boundary
// with a reversible fake so tests can assert exactly what plaintext gets
// "encrypted" and control what "decrypts" back out, without touching real
// AWS KMS.
vi.mock('../../../security/src/kms', () => ({
  encryptField: vi.fn(async (value: string) => `ENC(${value})`),
  decryptField: vi.fn(async (encoded: string) => encoded.slice(4, -1)),
}));

// @platform/utils is NOT mocked -- AppError/ErrorCode/parseUserId are real,
// side-effect-free logic and we want to assert against the real error codes.

import * as fs from 'fs';
import { withTenantQuery } from '@platform/tenancy';
import { encryptField, decryptField } from '../../../security/src/kms';
import { ErrorCode } from '@platform/utils';
import {
  startOAuthFlow,
  handleOAuthCallback,
  triggerSync,
  getSyncLogs,
  kmsEncrypt,
  kmsDecrypt,
} from '../index';

const mockedWithTenantQuery = withTenantQuery as unknown as ReturnType<typeof vi.fn>;

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const connectionId = '33333333-3333-3333-3333-333333333333';

function mockConfig(cfg: unknown) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('startOAuthFlow', () => {
  it('BUG: authUrl always points at Google OAuth, regardless of `provider`', async () => {
    mockConfig({ enabled: true, tiers: { slack: true }, limits: { connectorCount: 5 } });

    const result = await startOAuthFlow(tenantId, 'slack', userId);

    // BUG: `provider` is only ever used for the tier-gate check above -- it
    // is never interpolated into the authUrl, so a 'slack' OAuth flow still
    // returns Google's authorize endpoint. Real fix: look up a per-provider
    // OAuth endpoint (and real client_id) from config, keyed by `provider`.
    expect(result.authUrl).toContain('https://accounts.google.com/o/oauth2/auth');
    expect(result.authUrl).not.toContain('slack');

    // BUG: client_id is the literal string 'client_id', not a real
    // configured value.
    expect(result.authUrl).toContain('client_id=client_id');

    expect(result.state).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws FORBIDDEN when integrations are globally disabled', async () => {
    mockConfig({ enabled: false, tiers: { slack: true }, limits: { connectorCount: 5 } });

    await expect(startOAuthFlow(tenantId, 'slack', userId)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Integrations disabled',
    });
  });

  it('throws FORBIDDEN when the provider tier flag is false', async () => {
    mockConfig({ enabled: true, tiers: { slack: true, quickbooks: false }, limits: { connectorCount: 5 } });

    await expect(startOAuthFlow(tenantId, 'quickbooks', userId)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Provider quickbooks is not available on your current tier',
    });
  });

  it('falls back to hardcoded defaults when the config file is missing', async () => {
    (fs.existsSync as any).mockReturnValue(false);

    // Hardcoded default tiers include slack: true, so this should succeed.
    const result = await startOAuthFlow(tenantId, 'slack', userId);
    expect(result.authUrl).toContain('https://accounts.google.com');
  });

  it('falls back to defaults and warns when the config file fails to parse', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockImplementation(() => {
      throw new Error('disk read error');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await startOAuthFlow(tenantId, 'googleWorkspace', userId);

    expect(result.authUrl).toContain('https://accounts.google.com');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('handleOAuthCallback', () => {
  it('DEFECT: fabricates OAuth tokens instead of performing a real code-for-token exchange', async () => {
    mockConfig({ enabled: true, tiers: { slack: true }, limits: { connectorCount: 5 } });
    const insertedRow = {
      id: connectionId,
      tenant_id: tenantId,
      provider: 'slack',
      external_id: 'ext_slack_deadbeef',
    };
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ count: '1' }]) // under limit
      .mockResolvedValueOnce([insertedRow]);   // insert result

    const result = await handleOAuthCallback(tenantId, 'slack', 'oauth-code-abc123', 'whatever-state', userId);

    expect(result).toEqual(insertedRow);

    // DEFECT: no real provider token exchange ever happens. The "access
    // token" is just a string embedding the auth code; the "refresh token"
    // is a hardcoded literal that never varies by provider, user, or code.
    // Real fix: POST `code` to the provider's real token endpoint and
    // persist whatever access/refresh tokens actually come back.
    expect(encryptField).toHaveBeenNthCalledWith(1, 'mock_access_token_oauth-code-abc123');
    expect(encryptField).toHaveBeenNthCalledWith(2, 'mock_refresh_token_xyz');
  });

  it('throws FORBIDDEN when the connector limit is reached, before ever attempting the insert', async () => {
    mockConfig({ enabled: true, tiers: { slack: true }, limits: { connectorCount: 5 } });
    mockedWithTenantQuery.mockResolvedValueOnce([{ count: '5' }]);

    await expect(
      handleOAuthCallback(tenantId, 'slack', 'code', 'state', userId),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Connector connection limits reached',
    });
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid userId with BAD_REQUEST before touching the database', async () => {
    mockConfig({ enabled: true, tiers: { slack: true }, limits: { connectorCount: 5 } });

    await expect(
      handleOAuthCallback(tenantId, 'slack', 'code', 'state', 'not-a-uuid'),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('GAP: accepts any `state` value -- no CSRF validation against the token startOAuthFlow issued', async () => {
    mockConfig({ enabled: true, tiers: { slack: true }, limits: { connectorCount: 5 } });
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ id: connectionId }]);

    // A real OAuth callback must reject a `state` that doesn't match the one
    // issued in startOAuthFlow. This function has no comparison logic at
    // all -- any string is accepted. Real fix: persist the state issued by
    // startOAuthFlow (session/DB, keyed by tenant+user) and compare it here
    // before proceeding, rejecting on mismatch.
    await expect(
      handleOAuthCallback(tenantId, 'slack', 'code', 'totally-unrelated-state-value', userId),
    ).resolves.toBeDefined();
  });

  it('BUG: ignores cfg.enabled -- a callback still completes even when integrations are globally disabled', async () => {
    mockConfig({ enabled: false, tiers: { slack: true }, limits: { connectorCount: 5 } });
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ id: connectionId }]);

    // Unlike startOAuthFlow, handleOAuthCallback never checks cfg.enabled.
    // Real fix: add the same `if (!cfg.enabled) throw ...` guard here.
    await expect(
      handleOAuthCallback(tenantId, 'slack', 'code', 'state', userId),
    ).resolves.toBeDefined();
  });
});

describe('triggerSync', () => {
  it('DEFECT: records_synced/status are hardcoded; BUG: the sync-duration timer is dead code', async () => {
    const plaintext = 'access-token-plaintext-1234567890';
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ id: connectionId, tenant_id: tenantId, access_token_enc: `ENC(${plaintext})` }])
      .mockResolvedValueOnce([{
        id: 'log-id',
        tenant_id: tenantId,
        connection_id: connectionId,
        status: 'success',
        records_synced: 24,
        completed_at: '2026-01-01T00:00:00.000Z',
      }]);

    const result = await triggerSync(tenantId, connectionId);

    expect(decryptField).toHaveBeenCalledWith(`ENC(${plaintext})`);
    expect(result.decrypted_token_sample).toBe(plaintext.substring(0, 16) + '...');

    // DEFECT: status='success' and records_synced=24 are hardcoded directly
    // in the SQL literal -- this can never reflect a real failure or an
    // actual record count. Real fix: perform a real sync against the
    // provider and persist its real outcome/count.
    expect(result.status).toBe('success');
    expect(result.records_synced).toBe(24);

    // BUG: `const start = Date.now()` is computed but never read again --
    // no duration is calculated or persisted anywhere. Confirmed here: the
    // INSERT only ever receives 3 params (log id, tenant id, connection id),
    // never a duration/elapsed value.
    const insertCallArgs = mockedWithTenantQuery.mock.calls[1];
    expect(insertCallArgs[1]).toHaveLength(3);
  });

  it('throws NOT_FOUND when the connection does not exist for this tenant', async () => {
    mockedWithTenantQuery.mockResolvedValueOnce([]);

    await expect(triggerSync(tenantId, connectionId)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'Connection not found',
    });
  });
});

describe('getSyncLogs', () => {
  it('returns the rows exactly as the tenant-scoped query returns them', async () => {
    const rows = [
      { id: 'log-1', connection_id: connectionId, status: 'success', records_synced: 24 },
      { id: 'log-2', connection_id: connectionId, status: 'success', records_synced: 24 },
    ];
    mockedWithTenantQuery.mockResolvedValueOnce(rows);

    const result = await getSyncLogs(tenantId, connectionId);

    expect(result).toEqual(rows);
    expect(mockedWithTenantQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM integration_sync_logs'),
      [connectionId, tenantId],
      tenantId,
    );
  });

  it('returns an empty array when there are no sync logs', async () => {
    mockedWithTenantQuery.mockResolvedValueOnce([]);
    const result = await getSyncLogs(tenantId, connectionId);
    expect(result).toEqual([]);
  });
});

describe('kmsEncrypt / kmsDecrypt', () => {
  it('delegate to the real KMS envelope helpers in platform/security', async () => {
    const cipher = await kmsEncrypt('hello-world');
    expect(cipher).toBe('ENC(hello-world)');
    expect(encryptField).toHaveBeenCalledWith('hello-world');

    const plain = await kmsDecrypt('ENC(hello-world)');
    expect(plain).toBe('hello-world');
    expect(decryptField).toHaveBeenCalledWith('ENC(hello-world)');
  });
});
