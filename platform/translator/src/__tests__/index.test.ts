/**
 * @platform/translator
 * LIMITATION: translation body is a simulated string, not a real LLM call.
 * PII scrubbing is mandatory when configured; cache hit skips generation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockRecordUsage = vi.fn().mockResolvedValue(undefined);
const mockLoadConfig = vi.fn();
const mockFilterPii = vi.fn((text: string) => ({ sanitized: text.replace(/\d{3}-\d{2}-\d{4}/g, '[REDACTED]') }));

vi.mock('../../../utils/src/index', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN' },
}));
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../../ai-safety/src/index', () => ({
  filterPii: (...a: unknown[]) => mockFilterPii(...a),
}));
vi.mock('../../../metering/src/index', () => ({
  recordUsage: (...a: unknown[]) => mockRecordUsage(...a),
}));

import { translateToPlainLanguage, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('translator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      enabled: true,
      piiScrubbingMandatory: true,
      defaultReadingLevel: 'grade6',
    });
  });

  it('FORBIDDEN when disabled', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false, piiScrubbingMandatory: true, defaultReadingLevel: 'grade6' });
    await expect(translateToPlainLanguage(TENANT, 'hello'))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('returns cached translation without re-generating', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ translated_text: 'Cached plain text' }]);
    const result = await translateToPlainLanguage(TENANT, 'Complex legal prose here');
    expect(result).toEqual({ translated: 'Cached plain text', cached: true });
    expect(mockRecordUsage).not.toHaveBeenCalled();
    expect(mockWithTenantQuery).toHaveBeenCalledTimes(1); // cache lookup only
  });

  it('scrubs PII, simulates translation, caches, and meters (LIMITATION: simulated LLM)', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([])  // cache miss
      .mockResolvedValueOnce([]); // insert cache
    const result = await translateToPlainLanguage(
      TENANT,
      // BUG (test data, not source): source truncates the scrubbed text to
      // substring(0,20) before building the simulated translation. With the
      // SSN starting at char 12 in the original wording, the '[REDACTED]'
      // marker gets sliced off mid-token — putting the SSN at the very
      // start keeps the whole marker inside the first 20 chars.
      'SSN 123-45-6789 needs plain language',
      'grade8',
    );
    expect(mockFilterPii).toHaveBeenCalled();
    expect(result.cached).toBe(false);
    expect(result.translated).toMatch(/^\[PLAIN LANGUAGE VERSION of:/);
    expect(result.translated).toContain('[REDACTED]');
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      eventType: 'api_call',
    }));
  });

  it('skips PII filter when piiScrubbingMandatory is false', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true, piiScrubbingMandatory: false, defaultReadingLevel: 'grade6',
    });
    mockWithTenantQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await translateToPlainLanguage(TENANT, 'SSN 123-45-6789');
    expect(mockFilterPii).not.toHaveBeenCalled();
  });
});
