import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockImplementation((name: string) => {
      if (name === 'persona-router') {
        return {
          enabled: true,
          tierOrder: ['scout', 'commander', 'general', 'war_council'],
          defaultHumanityLevel: 0,
        };
      }
      return {
        enabled: true,
        maxPersonasPerBlend: 4,
        minTier: 'commander',
      };
    }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { __resetPersonaRouterStore } from '@platform/persona-router';
import {
  composeBlend,
  saveBlend,
  assembleBlendPrompt,
  __resetBlendStudioStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-0000000000aa';

describe('blend-studio', () => {
  beforeEach(() => {
    __resetBlendStudioStore();
    __resetPersonaRouterStore();
    vi.clearAllMocks();
  });

  it('composes weighted blend', async () => {
    const result = await composeBlend(tenantId, userId, {
      blend: {
        'persona-scout-guide': 1,
        'persona-commander': 2,
      },
      userTier: 'commander',
      humanityLevel: 2,
    });
    expect(result.systemPrompt).toContain('blended multi-persona');
    expect(result.personas).toHaveLength(2);
    const commander = result.personas.find((p) => p.id === 'persona-commander');
    expect(commander!.weightPct).toBeCloseTo(66.7, 0);
  });

  it('rejects scout tier', async () => {
    try {
      await composeBlend(tenantId, userId, {
        blend: { 'persona-scout-guide': 1 },
        userTier: 'scout',
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/tier/i);
    }
  });

  it('saves favorite blend', async () => {
    const saved = await saveBlend(tenantId, userId, {
      name: 'Strategy Mix',
      blend: { 'persona-commander': 1, 'persona-scout-guide': 1 },
    });
    expect(saved.name).toBe('Strategy Mix');
  });

  it('assembleBlendPrompt lists weights', () => {
    const prompt = assembleBlendPrompt(
      [
        { name: 'A', weight: 0.7, promptBody: 'body-a' },
        { name: 'B', weight: 0.3, promptBody: 'body-b' },
      ],
      0,
    );
    expect(prompt).toContain('70%');
    expect(prompt).toContain('body-a');
  });
});
