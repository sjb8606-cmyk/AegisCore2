/**
 * @platform/developer-portal
 * Sandbox key returns raw key once; hash stored. Key count gated.
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN' },
  parseUserId: (id: string) => id,
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  publishApiSpec, getPublishedSpec, createChangelogEntry, createSandboxKey, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

describe('developer-portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishApiSpec FORBIDDEN when disabled or tier off', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false, tiers: { openApiSpec: true }, limits: { sandboxApiKeys: 5 },
    }));
    await expect(publishApiSpec(TENANT, '1.0.0', { openapi: '3.0.0' }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('publishApiSpec inserts published spec', async () => {
    const row = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', version: '1.0.0', is_published: true };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await publishApiSpec(TENANT, '1.0.0', { openapi: '3.0.0', paths: {} });
    expect(result).toEqual(row);
  });

  it('getPublishedSpec returns latest published', async () => {
    const row = { version: '1.0.0', is_published: true };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(await getPublishedSpec(TENANT)).toEqual(row);
  });

  it('createChangelogEntry inserts entry', async () => {
    const row = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', title: 'New endpoint' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createChangelogEntry(TENANT, USER, {
      version: '1.1.0', title: 'New endpoint', type: 'feature', description: 'Added /v2/x',
    });
    expect(result).toEqual(row);
  });

  it('createSandboxKey FORBIDDEN at limit', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ count: '5' }]);
    await expect(createSandboxKey(TENANT, USER, 'dev-key'))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/Sandbox Key limits/i) });
  });

  it('createSandboxKey returns raw key + hashed record', async () => {
    const record = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', key_prefix: 'rtk_sandbox_' };
    mockWithTenantQuery.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([record]);
    const result = await createSandboxKey(TENANT, USER, 'dev-key');
    expect(result.key).toMatch(/^rtk_sandbox_[0-9a-f]+$/);
    expect(result.record).toEqual(record);
    // stored hash is sha256 of raw key
    const { createHash } = await import('crypto');
    const expectedHash = createHash('sha256').update(result.key).digest('hex');
    expect(mockWithTenantQuery.mock.calls[1][1][3]).toBe(expectedHash);
  });
});
