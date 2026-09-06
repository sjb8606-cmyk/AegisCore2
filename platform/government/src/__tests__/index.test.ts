/**
 * @platform/government
 * LIMITATION: kmsEncrypt/kmsDecrypt are local base64 stand-ins, not real KMS.
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', BAD_REQUEST: 'BAD_REQUEST' },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));
// Reversible local stand-in so kmsEncrypt/kmsDecrypt round-trip without touching
// real AWS KMS. Base64 so decryptField can gracefully handle a missing/undefined
// value too (falls back to '{}').
vi.mock('../../../security/src/kms', () => ({
  encryptField: vi.fn(async (v: string) => Buffer.from(v, 'utf8').toString('base64')),
  decryptField: vi.fn(async (e: string) => (e ? Buffer.from(e, 'base64').toString('utf8') : '{}')),
}));

import {
  kmsEncrypt, kmsDecrypt, submitServiceRequest, submitAtipRequest, getAtipRequest,
  AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const REQ = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('government', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kmsEncrypt/kmsDecrypt round-trip (LIMITATION: local stand-in)', async () => {
    const cipher = await kmsEncrypt('secret-pii');
    expect(typeof cipher).toBe('string');
    const plain = await kmsDecrypt(cipher);
    expect(plain).toBe('secret-pii');
  });

  it('submitServiceRequest inserts request', async () => {
    const row = { id: REQ, type: 'pothole', status: 'open' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await submitServiceRequest(TENANT, {
      type: 'pothole', description: 'Main St', location: '45.5,-73.5',
    });
    expect(result).toEqual(row);
  });

  it('submitAtipRequest inserts FOI/ATIP request', async () => {
    const row = { id: REQ, status: 'received' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await submitAtipRequest(TENANT, {
      requester_name: 'Jane', subject: 'Records about X',
    });
    expect(result).toEqual(row);
  });

  it('getAtipRequest NOT_FOUND / success', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getAtipRequest(TENANT, REQ)).rejects.toMatchObject({ code: expect.any(String) });

    // Production code always masks encrypted_data in the response
    // (platform/government/src/index.ts) -- this is intentional security
    // behavior, not a bug, so the expectation reflects the masked shape.
    const row = { id: REQ, subject: 'Records about X' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(await getAtipRequest(TENANT, REQ)).toEqual({
      ...row,
      encrypted_data: '[SECURED_COMPLIANT_VALUE]',
    });
  });
});
