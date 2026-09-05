/**
 * @platform/synthetic
 * Caps batch size to maxBatchSize; only allowedTypes generate data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn().mockResolvedValue([]);
const mockRecordUsage = vi.fn().mockResolvedValue(undefined);
const mockLoadConfig = vi.fn();

vi.mock('../../utils/src/index', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST' },
}));
vi.mock('../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../metering/src/index', () => ({
  recordUsage: (...a: unknown[]) => mockRecordUsage(...a),
}));

import { generateMirage, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('synthetic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      enabled: true,
      allowedTypes: ['user', 'transaction'],
      limits: { maxBatchSize: 5 },
    });
  });

  it('FORBIDDEN when disabled', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false, allowedTypes: ['user'], limits: { maxBatchSize: 5 } });
    await expect(generateMirage(TENANT, 'user', 3)).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('BAD_REQUEST for unsupported type', async () => {
    await expect(generateMirage(TENANT, 'invoice', 3))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/Unsupported data type/i) });
  });

  it('caps count to maxBatchSize and returns user records', async () => {
    const data = await generateMirage(TENANT, 'user', 100);
    expect(data).toHaveLength(5);
    expect(data[0]).toMatchObject({
      email: expect.stringMatching(/@example\.internal$/),
      role: 'tester',
    });
    expect(data[0].id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mockWithTenantQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO synthetic_data_logs/i),
      expect.arrayContaining([TENANT, null, 'user', 5, 'founder']),
      TENANT,
    );
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it('generates transaction records with amount/currency', async () => {
    const data = await generateMirage(TENANT, 'transaction', 2, 'sandbox-1');
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ currency: 'USD', status: 'completed' });
    expect(mockWithTenantQuery.mock.calls[0][1][1]).toBe('sandbox-1');
  });
});
