import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/metering', () => ({ recordUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      provider: 'mock',
      limits: { maxPromptChars: 2000, generationsPerDay: 50 },
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  generateImage,
  generateMusic,
  generateVideoFromPrompt,
  __resetAiGenerationStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('ai-generation', () => {
  beforeEach(() => {
    __resetAiGenerationStore();
    vi.clearAllMocks();
  });

  it('generates image', async () => {
    const r = await generateImage(tenantId, actorId, 'a red boat');
    expect(r.kind).toBe('image');
    expect(r.url).toContain('.png');
  });

  it('generates music', async () => {
    const r = await generateMusic(tenantId, actorId, 'lofi beat');
    expect(r.kind).toBe('music');
  });

  it('generates video', async () => {
    const r = await generateVideoFromPrompt(tenantId, actorId, 'drone shot');
    expect(r.kind).toBe('video');
  });

  it('rejects empty prompt', async () => {
    await expect(generateImage(tenantId, actorId, '  ')).rejects.toThrow(/prompt/i);
  });
});
