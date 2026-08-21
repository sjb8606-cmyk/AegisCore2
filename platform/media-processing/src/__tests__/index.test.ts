import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/metering', () => ({ recordUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({ enabled: true, maxInputMb: 50 }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { applyTransform, __resetMediaProcessingStore } from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('media-processing', () => {
  beforeEach(() => {
    __resetMediaProcessingStore();
    vi.clearAllMocks();
  });

  it('resizes image', async () => {
    const job = await applyTransform(tenantId, actorId, {
      op: 'resize',
      inputUrl: 'https://cdn.mock/a.png',
      params: { width: 256 },
    });
    expect(job.outputUrl).toContain('processed');
  });

  it('creates thumbnail', async () => {
    const job = await applyTransform(tenantId, actorId, {
      op: 'thumbnail',
      inputUrl: 'https://cdn.mock/v.mp4',
    });
    expect(job.op).toBe('thumbnail');
  });

  it('rejects missing url', async () => {
    await expect(
      applyTransform(tenantId, actorId, { op: 'crop', inputUrl: '' }),
    ).rejects.toThrow(/inputUrl/i);
  });
});
