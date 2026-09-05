/**
 * @platform/verifier
 * IMPORTANT: mock paths are relative to THIS test file (__tests__/),
 * so we use ../../../ not ../../
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockVerifyChainIntegrity = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock('../../../utils/src/index', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AppError';
      this.code = code;
    }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN',
    INTERNAL: 'INTERNAL',
  },
}));

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('../../../audit-log/src/index', () => ({
  verifyChainIntegrity: (...args: unknown[]) => mockVerifyChainIntegrity(...args),
}));

import { runIntegrityCheck, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('verifier', () => {
  beforeEach(() => {
    mockWithTenantQuery.mockReset();
    mockVerifyChainIntegrity.mockReset();
    mockLoadConfig.mockReset();
    mockLoadConfig.mockReturnValue({ enabled: true, deepVerification: true });
  });

  it('FORBIDDEN when disabled', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false, deepVerification: false });
    await expect(runIntegrityCheck(TENANT)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('returns SECURE when chain verifies', async () => {
    mockVerifyChainIntegrity.mockResolvedValueOnce({
      verified: true,
      total_events_checked: 42,
    });
    mockWithTenantQuery
      .mockResolvedValueOnce([{ sequence: 42, event_hash: 'abc' }])
      .mockResolvedValueOnce([]);

    const result = await runIntegrityCheck(TENANT);
    expect(result).toEqual({
      valid: true,
      checked: 42,
      verdict: 'SECURE',
    });
  });

  it('returns COMPROMISED when chain is broken', async () => {
    mockVerifyChainIntegrity.mockResolvedValueOnce({
      verified: false,
      failed_sequence: 7,
      expected_hash: 'want',
      actual_hash: 'got',
      total_events_checked: 10,
    });
    mockWithTenantQuery
      .mockResolvedValueOnce([{ sequence: 10, event_hash: 'got' }])
      .mockResolvedValueOnce([]);

    const result = await runIntegrityCheck(TENANT);
    expect(result).toEqual({
      valid: false,
      checked: 0,
      verdict: 'COMPROMISED',
    });
    expect(mockWithTenantQuery.mock.calls[1][1][3]).toBe('corrupted');
  });
});
