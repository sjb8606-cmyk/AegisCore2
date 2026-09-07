import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockLoadConfig = vi.fn();
const mockRecordUsage = vi.fn();

vi.mock('../../../utils/src/index', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.name = 'AppError'; this.code = code; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST' },
}));
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../../metering/src/index', () => ({
  recordUsage: (...a: unknown[]) => mockRecordUsage(...a),
}));

import { requestFileUpload } from '../index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// Real ConfigSchema: { enabled, limits: { maxFileSizeMb }, storage: { bucket, region } }
function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    limits: { maxFileSizeMb: 5 },
    storage: { bucket: 'aegis-files', region: 'us-east-1' },
    ...overrides,
  };
}

describe('files: requestFileUpload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLoadConfig.mockReturnValue(validConfig());
    mockRecordUsage.mockResolvedValue(undefined);
  });

  it('BUG: throws a plain Error (no .code) when disabled, not an AppError', async () => {
    // Real source: `if (!config.enabled) throw new Error('Files feature disabled');`
    // — unlike the rest of the codebase, this is never wrapped in AppError,
    // so callers checking `.code === ErrorCode.FORBIDDEN` get `undefined`
    // instead. The real fix: `throw new AppError('Files feature disabled', ErrorCode.FORBIDDEN)`.
    mockLoadConfig.mockReturnValue(validConfig({ enabled: false }));

    let caught: any;
    try {
      await requestFileUpload(TENANT_ID, 'a.png', 100, USER_ID);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.code).toBeUndefined();
    expect(caught.message).toBe('Files feature disabled');
  });

  it('rejects files over the configured size limit (real maxFileSizeMb field)', async () => {
    mockLoadConfig.mockReturnValue(validConfig({ limits: { maxFileSizeMb: 1 } })); // 1MB limit

    await expect(requestFileUpload(TENANT_ID, 'big.bin', 2 * 1024 * 1024, USER_ID))
      .rejects.toThrow(/exceeds limit/i);
  });

  it('allows a file at or under the size limit', async () => {
    mockLoadConfig.mockReturnValue(validConfig({ limits: { maxFileSizeMb: 1 } }));
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'file-1' }]);

    await expect(requestFileUpload(TENANT_ID, 'small.bin', 1024 * 1024, USER_ID))
      .resolves.toBeDefined();
  });

  it('success path: inserts the ledger row, meters usage, and returns a presigned-style URL', async () => {
    mockWithTenantQuery.mockImplementation(async (sql: string, params: any[]) => {
      const [fileId, tenantId, uploadedBy, filename] = params;
      return [{ id: fileId, tenant_id: tenantId, uploaded_by: uploadedBy, name: filename }];
    });

    const result = await requestFileUpload(TENANT_ID, 'photo.png', 1024, USER_ID);

    expect(result.fileId).toEqual(expect.any(String));
    expect(result.s3Key).toBe(`files/${TENANT_ID}/${result.fileId}/photo.png`);
    expect(result.uploadUrl).toContain('aegis-files.s3.us-east-1.amazonaws.com');
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID, eventType: 'api_call', quantity: 1,
    }));
  });
});
