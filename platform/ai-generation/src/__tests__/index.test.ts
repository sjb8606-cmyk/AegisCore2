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
    AppError: class AppError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.name = 'AppError';
        this.code = code;
      }
    },
    ErrorCode: { BAD_REQUEST: 'BAD_REQUEST', NOT_IMPLEMENTED: 'NOT_IMPLEMENTED' },
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@platform/crud-kernel', () => ({
  runCrudOperation: async ({ action }: any) => action(),
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

  it('throws NOT_IMPLEMENTED for image generation', async () => {
    await expect(generateImage(tenantId, actorId, 'a red boat')).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
  });

  it('throws NOT_IMPLEMENTED for music generation', async () => {
    await expect(generateMusic(tenantId, actorId, 'lofi beat')).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
  });

  it('throws NOT_IMPLEMENTED for video generation', async () => {
    await expect(generateVideoFromPrompt(tenantId, actorId, 'drone shot')).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
  });

  it('rejects empty prompt', async () => {
    await expect(generateImage(tenantId, actorId, '  ')).rejects.toThrow(/prompt/i);
  });
});
