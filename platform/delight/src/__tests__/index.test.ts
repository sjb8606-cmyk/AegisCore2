import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const readdirSyncMock = vi.fn(actual.readdirSync as any);
  return {
    ...actual,
    readdirSync: readdirSyncMock,
    default: { ...actual, readdirSync: readdirSyncMock },
  };
});

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

vi.mock('@platform/ai-gateway', () => ({
  generateText: vi.fn(),
}));

import * as fs from 'fs';
import { processChat, refreshPersonaIndex, resolvePersonaDir } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import { emit as auditEmit } from '@platform/audit';
import { generateText } from '@platform/ai-gateway';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const PERSONA_ID = 'orchard_farmer';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('persona index caching — the real speed fix', () => {
  it('does NOT re-walk the directory tree on a second call for a different persona', async () => {
    (withTenantQuery as any).mockResolvedValue([]);
    (generateText as any).mockResolvedValue({ content: 'ok', provider: 'groq', model: 'x', finishReason: 'stop' });

    await processChat(TENANT_ID, 'first message', { personaId: 'orchard_farmer', sessionId: 'session-cache-1' });
    const callsAfterFirst = (fs.readdirSync as any).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await processChat(TENANT_ID, 'second message', { personaId: 'flat_roof_specialist', sessionId: 'session-cache-2' });
    const callsAfterSecond = (fs.readdirSync as any).mock.calls.length;

    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it('refreshPersonaIndex() forces a real rebuild when explicitly called', async () => {
    (withTenantQuery as any).mockResolvedValue([]);
    (generateText as any).mockResolvedValue({ content: 'ok', provider: 'groq', model: 'x', finishReason: 'stop' });

    await processChat(TENANT_ID, 'warm the cache', { personaId: PERSONA_ID, sessionId: 'session-cache-3' });
    const callsBeforeRefresh = (fs.readdirSync as any).mock.calls.length;

    refreshPersonaIndex(resolvePersonaDir());
    const callsAfterRefresh = (fs.readdirSync as any).mock.calls.length;

    expect(callsAfterRefresh).toBeGreaterThan(callsBeforeRefresh);
  });
});

describe('processChat — real LLM wiring', () => {
  it('calls the real Groq model and returns its actual content, not a canned string', async () => {
    (withTenantQuery as any).mockResolvedValue([]);
    (generateText as any).mockResolvedValue({
      provider: 'groq',
      model: 'llama-4-scout-17b-16e-instruct',
      content: 'Prune in late dormancy, before bud swell — that is your real window here.',
      finishReason: 'stop',
    });

    const result = await processChat(TENANT_ID, 'When should I prune my apple trees?', {
      personaId: PERSONA_ID,
      sessionId: 'session-1',
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('Prune in late dormancy');
    expect(result.text).not.toContain('I have strategized');
    expect(result.text).toContain('Bernard');
  });

  it('builds a system prompt from the real persona worldview, not a generic placeholder', async () => {
    (withTenantQuery as any).mockResolvedValue([]);
    (generateText as any).mockResolvedValue({ content: 'ok', provider: 'groq', model: 'x', finishReason: 'stop' });

    await processChat(TENANT_ID, 'test message', { personaId: PERSONA_ID, sessionId: 'session-2' });

    const callArgs = (generateText as any).mock.calls[0][0];
    const systemMessage = callArgs.messages.find((m: any) => m.role === 'system');
    expect(systemMessage.content).toContain('long-term investment');
  });

  it('includes real conversation history, in chronological order, in the LLM call', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { role: 'assistant', content: 'Second reply' },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'First reply' },
      { role: 'user', content: 'First question' },
    ]);
    (generateText as any).mockResolvedValue({ content: 'ok', provider: 'groq', model: 'x', finishReason: 'stop' });

    await processChat(TENANT_ID, 'newest question', { personaId: PERSONA_ID, sessionId: 'session-3' });

    const callArgs = (generateText as any).mock.calls[0][0];
    const historyMessages = callArgs.messages.slice(1, -1);
    expect(historyMessages[0].content).toBe('First question');
    expect(historyMessages[3].content).toBe('Second reply');
  });

  it('stores BOTH the user message and the assistant reply', async () => {
    (withTenantQuery as any).mockResolvedValue([]);
    (generateText as any).mockResolvedValue({ content: 'a real reply', provider: 'groq', model: 'x', finishReason: 'stop' });

    await processChat(TENANT_ID, 'my real question', { personaId: PERSONA_ID, sessionId: 'session-4' });

    const insertCalls = (withTenantQuery as any).mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO conversations'),
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toContain('user');
    expect(insertCalls[0][1]).toContain('my real question');
    expect(insertCalls[1][1]).toContain('assistant');
  });

  it('short-circuits on a safety boundary hit WITHOUT ever calling the real LLM', async () => {
    const result = await processChat(TENANT_ID, 'I need a doctor for this pain', {
      personaId: PERSONA_ID,
      sessionId: 'session-5',
    });

    expect(result.boundaryHit).toBe(true);
    expect(generateText).not.toHaveBeenCalled();
    expect(auditEmit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.safety_violation' }),
    );
  });

  it('uses a blended system prompt in blend mode, with no single persona.json required', async () => {
    (withTenantQuery as any).mockResolvedValue([]);
    (generateText as any).mockResolvedValue({ content: 'blended reply', provider: 'groq', model: 'x', finishReason: 'stop' });

    const result = await processChat(TENANT_ID, 'test', { blend: true, sessionId: 'session-6' });

    expect(result.text).toContain('A Unique Synthesis');
    const callArgs = (generateText as any).mock.calls[0][0];
    const systemMessage = callArgs.messages.find((m: any) => m.role === 'system');
    expect(systemMessage.content).toContain('blended identity');
  });
});
