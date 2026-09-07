/**
 * @platform/forms
 * LIMITATION: throws plain Error (not AppError) when disabled.
 * Encrypts payload when encryptedSubmissions tier is on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn().mockResolvedValue([]);
const mockLoadConfig = vi.fn();
const mockEncrypt = vi.fn(async (p: string) => ({ ciphertext: 'enc:' + p, keyId: 'k1' }));
const mockAuditEmit = vi.fn().mockResolvedValue(undefined);
const mockRecordUsage = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../utils/src/index', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
}));
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../../audit/src/index', () => ({
  emit: (...a: unknown[]) => mockAuditEmit(...a),
}));
vi.mock('../../../metering/src/index', () => ({
  recordUsage: (...a: unknown[]) => mockRecordUsage(...a),
}));
vi.mock('../../../security/src/index', () => ({
  encrypt: (...a: unknown[]) => mockEncrypt(...a),
}));

import { submitForm } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const FORM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('forms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      enabled: true,
      tiers: { auditTrail: true, encryptedSubmissions: false },
      limits: {},
    });
  });

  it('throws plain Error when disabled (LIMITATION: not AppError)', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false, tiers: {}, limits: {} });
    await expect(submitForm(TENANT, FORM, { a: 1 })).rejects.toThrow(/Forms feature disabled/);
  });

  it('stores plain JSON when encryption off', async () => {
    const result = await submitForm(TENANT, FORM, { email: 'a@b.com' });
    expect(result).toEqual({ success: true, message: 'Data saved successfully' });
    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(mockWithTenantQuery.mock.calls[0][1][2]).toBe(JSON.stringify({ email: 'a@b.com' }));
    expect(mockAuditEmit).toHaveBeenCalled();
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it('encrypts payload when encryptedSubmissions tier on', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true,
      tiers: { auditTrail: false, encryptedSubmissions: true },
      limits: {},
    });
    await submitForm(TENANT, FORM, { ssn: '123-45-6789' });
    expect(mockEncrypt).toHaveBeenCalled();
    const stored = mockWithTenantQuery.mock.calls[0][1][2];
    expect(stored).toContain('ciphertext');
    expect(mockAuditEmit).not.toHaveBeenCalled();
  });
});
