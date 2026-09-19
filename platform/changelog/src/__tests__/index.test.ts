import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/src/index', () => ({
  loadConfig: vi.fn().mockReturnValue({
    enabled: true,
    tiers: { fieldLevelHighlighting: true, plainLanguageSummary: true },
    limits: { maxEntriesPerPage: 50 },
  }),
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
  withTenantQuery: vi.fn(),
}));

vi.mock('../../../metering/src/index', () => ({
  recordUsage: vi.fn(),
}));

import { getTimeline } from '../index';

describe('changelog', () => {
  it('throws NOT_IMPLEMENTED instead of returning fake diffs', async () => {
    await expect(
      getTimeline('11111111-1111-1111-1111-111111111111', 'order', 'order-1')
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('throws when disabled', async () => {
    const { loadConfig } = await import('../../../utils/src/index');
    (loadConfig as any).mockReturnValueOnce({ enabled: false });
    await expect(
      getTimeline('11111111-1111-1111-1111-111111111111', 'order', 'order-1')
    ).rejects.toThrow('Timeline disabled');
  });
});
