import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoadConfig = vi.fn();
const mockWithTenantQuery = vi.fn();
const mockFilterPii = vi.fn();
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', NOT_IMPLEMENTED: 'NOT_IMPLEMENTED' },
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

import { translateToPlainLanguage } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue({
    enabled: true,
    piiScrubbingMandatory: true,
    defaultReadingLevel: 'grade6',
  });
  mockFilterPii.mockReturnValue({ sanitized: 'clean text' });
});

describe('translateToPlainLanguage', () => {
  it('returns cached translation without re-generating', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ translated_text: 'cached result' }]);
    const result = await translateToPlainLanguage(TENANT, 'hello world');
    expect(result).toEqual({ translated: 'cached result', cached: true });
    expect(mockFilterPii).toHaveBeenCalled();
  });

  it('throws NOT_IMPLEMENTED on cache miss instead of returning fake translation', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]); // cache miss
    await expect(translateToPlainLanguage(TENANT, 'hello world')).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
  });

  it('skips PII filter when piiScrubbingMandatory is false', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true,
      piiScrubbingMandatory: false,
      defaultReadingLevel: 'grade6',
    });
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(translateToPlainLanguage(TENANT, 'SSN 123-45-6789')).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
    expect(mockFilterPii).not.toHaveBeenCalled();
  });
});
