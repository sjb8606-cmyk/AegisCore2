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
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      tierOrder: ['scout', 'commander', 'general', 'war_council'],
      defaultHumanityLevel: 0,
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

import {
  routePersona,
  assembleSystemPrompt,
  __setUserTier,
  __resetPersonaRouterStore,
  getPersona,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-0000000000aa';

describe('persona-router', () => {
  beforeEach(() => {
    __resetPersonaRouterStore();
    vi.clearAllMocks();
  });

  it('routes scout persona for scout tier', async () => {
    __setUserTier(userId, 'scout');
    const result = await routePersona(tenantId, userId, {
      personaId: 'persona-scout-guide',
    });
    expect(result.systemPrompt).toContain('Scout Guide');
  });

  it('blocks commander persona for scout tier', async () => {
    __setUserTier(userId, 'scout');
    await expect(
      routePersona(tenantId, userId, { personaId: 'persona-commander' }),
    ).rejects.toThrow(/tier|insufficient/i);
  });

  it('allows commander for commander tier', async () => {
    const result = await routePersona(tenantId, userId, {
      personaId: 'persona-commander',
      userTier: 'commander',
      humanityLevel: 4,
    });
    expect(result.systemPrompt).toMatch(/empathetic/i);
  });

  it('assembleSystemPrompt keeps order', () => {
    __resetPersonaRouterStore();
    const p = getPersona('persona-scout-guide');
    expect(p).not.toBeNull();
    expect(p!.name).toBe('Scout Guide');
    expect(p!.jsonConfig.identity).toContain('Scout Guide');

    const prompt = assembleSystemPrompt(p!, 0, {
      recentMessages: [{ role: 'user', content: 'hi' }],
      userContext: { goal: 'ship MVP' },
    });

    const idIdx = prompt.indexOf('Scout Guide');
    const memIdx = prompt.indexOf('Recent conversation');
    const patternIdx = prompt.indexOf('Response pattern');
    expect(idIdx).toBeGreaterThanOrEqual(0);
    expect(memIdx).toBeGreaterThan(idIdx);
    expect(patternIdx).toBeGreaterThan(memIdx);
  });
});
