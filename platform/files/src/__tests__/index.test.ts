import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockLoadConfig = vi.fn();
const mockRecordUsage = vi.fn();
const mockGetSignedUrl = vi.fn();

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
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...a: unknown[]) => mockGetSignedUrl(...a),
}));

import { requestFileUpload } from '../index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

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
    mockGetSignedUrl.mockResolvedValue(
      'https://aegis-files.s3.us-east-1.amazonaws.com/files/x?X-Amz-Signature=real-sig&X-Amz-Expires=900',
    );
  });

  it('FIXED: throws a real AppError with .code=FORBIDDEN when disabled (previously a bare Error)', async () => {
    mockLoadConfig.mockReturnValue(validConfig({ enabled: false }));

    let caught: any;
    try {
      await requestFileUpload(TENANT_ID, 'a.png', 100, USER_ID);
    } catch (err) {
      caught = err;
    }
    expect(caught.code).toBe('FORBIDDEN');
  });

  it('rejects files over the configured size limit', async () => {
    mockLoadConfig.mockReturnValue(validConfig({ limits: { maxFileSizeMb: 1 } }));

    await expect(requestFileUpload(TENANT_ID, 'big.bin', 2 * 1024 * 1024, USER_ID))
      .rejects.toThrow(/exceeds limit/i);
  });

  it('success path: inserts the ledger row, meters usage, and returns a REAL SigV4 presigned URL (the core bug this fixes)', async () => {
    mockWithTenantQuery.mockImplementation(async (sql: string, params: any[]) => {
      const [fileId, tenantId, uploadedBy, filename] = params;
      return [{ id: fileId, tenant_id: tenantId, uploaded_by: uploadedBy, name: filename }];
    });

    const result = await requestFileUpload(TENANT_ID, 'photo.png', 1024, USER_ID);

    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const commandArg = mockGetSignedUrl.mock.calls[0][1];
    expect(commandArg.input).toEqual(
      expect.objectContaining({ Bucket: 'aegis-files', Key: result.s3Key }),
    );
    expect(result.uploadUrl).toContain('X-Amz-Signature=real-sig');
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID, eventType: 'api_call', quantity: 1,
    }));
  });
});
