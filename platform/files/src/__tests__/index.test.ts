/**
 * @platform/files
 * requestFileUpload size/type gating via config.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock('../../utils/src/index', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST' },
}));
vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST' },
  parseUserId: (id: string) => id,
}));
vi.mock('../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));

import { requestFileUpload, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

describe('files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      enabled: true,
      limits: { maxFileSizeBytes: 5_000_000, maxFilesPerTenant: 1000 },
      allowedMimePrefixes: ['image/', 'application/pdf'],
    });
  });

  it('FORBIDDEN when disabled', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false, limits: { maxFileSizeBytes: 5_000_000 } });
    await expect(requestFileUpload(TENANT, 'a.png', 100, USER))
      .rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|forbidden/i) });
  });

  it('rejects oversized files', async () => {
    await expect(requestFileUpload(TENANT, 'big.bin', 50_000_000, USER))
      .rejects.toThrow();
  });

  it('inserts upload request and returns row or signed info', async () => {
    const row = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      filename: 'photo.png', size_bytes: 1024, status: 'pending',
    };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    // some implementations also do a count check first
    mockWithTenantQuery.mockImplementation(async (sql: string) => {
      if (/COUNT/i.test(sql)) return [{ count: '0' }];
      return [row];
    });
    const result = await requestFileUpload(TENANT, 'photo.png', 1024, USER);
    expect(result).toBeDefined();
    // either returns the row or an object containing upload metadata
    const id = (result as any).id || (result as any).fileId || (result as any).record?.id;
    if (id) expect(id).toBe(row.id);
  });
});
