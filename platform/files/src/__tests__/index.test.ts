import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockLoadConfig = vi.fn();
const mockRecordUsage = vi.fn();

vi.mock('../../../utils/src/index', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AppError';
      this.code = code;
    }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_IMPLEMENTED: 'NOT_IMPLEMENTED' },
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

function validConfig() {
  return {
    enabled: true,
    limits: { maxFileSizeMb: 10 },
    storage: { bucket: 'test-bucket', region: 'us-east-1' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue(validConfig());
  mockRecordUsage.mockResolvedValue(undefined);
  mockWithTenantQuery.mockResolvedValue([{ id: 'file-uuid-1' }]);
});

describe('requestFileUpload', () => {
  it('throws AppError with FORBIDDEN when disabled', async () => {
    mockLoadConfig.mockReturnValue({ ...validConfig(), enabled: false });
    await expect(
      requestFileUpload(TENANT_ID, 'photo.jpg', 1024, USER_ID)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws AppError with BAD_REQUEST when file is too large', async () => {
    await expect(
      requestFileUpload(TENANT_ID, 'huge.bin', 50 * 1024 * 1024, USER_ID)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('throws NOT_IMPLEMENTED instead of returning a fake presigned URL', async () => {
    await expect(
      requestFileUpload(TENANT_ID, 'photo.jpg', 1024, USER_ID)
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });

    expect(mockWithTenantQuery).toHaveBeenCalled();
    expect(mockRecordUsage).toHaveBeenCalled();
  });
});
