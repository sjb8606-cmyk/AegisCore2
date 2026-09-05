/**
 * @platform/versioning
 * Negotiation priority: header → query → path → pin → default; sunset blocks.
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
  extractVersionFromPath, registerVersion, pinTenantVersion,
  negotiateVersionForRequest, getVersionLedger, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const VER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('versioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extractVersionFromPath matches /vN prefix', () => {
    expect(extractVersionFromPath('/v2/users')).toBe('v2');
    expect(extractVersionFromPath('/api/users')).toBeNull();
  });

  it('registerVersion FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({ enabled: false }));
    await expect(registerVersion(TENANT, { version_label: 'v2' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('registerVersion rejects invalid label via zod', async () => {
    await expect(registerVersion(TENANT, { version_label: '2.0' })).rejects.toThrow();
  });

  it('registerVersion inserts draft version', async () => {
    const row = { id: VER, version_label: 'v2', status: 'draft' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await registerVersion(TENANT, { version_label: 'v2', status: 'draft' });
    expect(result).toEqual(row);
  });

  it('pinTenantVersion NOT_FOUND when version missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(pinTenantVersion(TENANT, { version_id: VER }, USER))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('pinTenantVersion upserts pin', async () => {
    const pin = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', version_id: VER };
    mockWithTenantQuery.mockResolvedValueOnce([{ id: VER }]).mockResolvedValueOnce([pin]);
    const result = await pinTenantVersion(TENANT, { version_id: VER }, USER);
    expect(result).toEqual(pin);
  });

  describe('negotiateVersionForRequest', () => {
    it('prefers header over query/path', async () => {
      // no sunset row
      mockWithTenantQuery.mockResolvedValueOnce([]);
      const v = await negotiateVersionForRequest(TENANT, 'v3', 'v2', '/v1/x');
      expect(v).toBe('v3');
    });

    it('falls back to path then default', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]); // sunset check
      const v = await negotiateVersionForRequest(TENANT, null, null, '/v4/items');
      expect(v).toBe('v4');
    });

    it('uses pin when nothing else provided', async () => {
      mockWithTenantQuery
        .mockResolvedValueOnce([{ version_label: 'v9' }]) // pin join
        .mockResolvedValueOnce([{ status: 'active' }]);   // sunset check
      const v = await negotiateVersionForRequest(TENANT, null, null, '/items');
      expect(v).toBe('v9');
    });

    it('FORBIDDEN when negotiated version is sunset', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([{ status: 'sunset' }]);
      await expect(negotiateVersionForRequest(TENANT, 'v1', null, ''))
        .rejects.toMatchObject({
          code: 'FORBIDDEN',
          message: expect.stringMatching(/sunsetted/i),
        });
    });

    it('falls back to defaultVersion when nothing matches', async () => {
      // no pin, no sunset row for default
      mockWithTenantQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const v = await negotiateVersionForRequest(TENANT, null, null, '/items');
      expect(v).toBe('v1');
    });
  });

  it('getVersionLedger NOT_FOUND / success with pins', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getVersionLedger(TENANT, VER)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const version = { id: VER, version_label: 'v2' };
    const pins = [{ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }];
    mockWithTenantQuery.mockResolvedValueOnce([version]).mockResolvedValueOnce(pins);
    const result = await getVersionLedger(TENANT, VER);
    expect(result.active_pins).toEqual(pins);
  });
});
