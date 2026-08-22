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
      systemPrompt: 'Help from context only.',
      knowledgeScope: ['products', 'orders', 'docs'],
      maxContextItems: 8,
      escalateKeywords: ['speak to human', 'agent', 'manager'],
      maxHistoryTurns: 20,
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
  indexKnowledge,
  startSession,
  chat,
  shouldEscalate,
  __resetDataChatbotStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const userId = 'customer-1';

describe('data-chatbot', () => {
  beforeEach(() => {
    __resetDataChatbotStore();
    vi.clearAllMocks();
  });

  it('shouldEscalate detects keywords', () => {
    expect(shouldEscalate('I want to speak to human', ['speak to human'])).toBe(
      true,
    );
    expect(shouldEscalate('what is the return policy', ['agent'])).toBe(false);
  });

  it('answers from indexed knowledge', async () => {
    await indexKnowledge(tenantId, actorId, {
      scope: 'products',
      title: 'Return policy',
      body: 'Returns accepted within 30 days with receipt.',
      tags: ['returns'],
    });
    const session = await startSession(tenantId, actorId, userId);
    const turn = await chat(tenantId, actorId, {
      sessionId: session.id,
      message: 'What is the return policy?',
    });
    expect(turn.escalated).toBe(false);
    expect(turn.contextUsed).toBeGreaterThan(0);
    expect(turn.reply.toLowerCase()).toMatch(/return|30 days/);
  });

  it('escalates on keyword', async () => {
    const session = await startSession(tenantId, actorId, userId);
    const turn = await chat(tenantId, actorId, {
      sessionId: session.id,
      message: 'I need to speak to human please',
    });
    expect(turn.escalated).toBe(true);
    await expect(
      chat(tenantId, actorId, {
        sessionId: session.id,
        message: 'hello?',
      }),
    ).rejects.toThrow(/escalated/i);
  });
});
