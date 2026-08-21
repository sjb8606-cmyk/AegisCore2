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
      recentMessageLimit: 10,
      factExtractionEnabled: true,
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
  storeMessage,
  getMemory,
  extractAndUpsertFacts,
  clearMemory,
  extractFactsFromMessage,
  __resetPersonaMemoryStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = 'user-1';
const personaId = 'persona-scout-guide';
const sessionId = 'sess-1';

describe('persona-memory', () => {
  beforeEach(() => {
    __resetPersonaMemoryStore();
    vi.clearAllMocks();
  });

  it('stores and retrieves messages', async () => {
    await storeMessage(tenantId, userId, {
      userId,
      personaId,
      sessionId,
      role: 'user',
      content: 'Hello',
    });
    const mem = await getMemory(tenantId, userId, personaId);
    expect(mem.recentMessages).toHaveLength(1);
  });

  it('extracts name fact', () => {
    const facts = extractFactsFromMessage('Hi, my name is Jordan.');
    expect(facts.some((f) => f.key === 'name' && f.value === 'Jordan')).toBe(
      true,
    );
  });

  it('upserts facts into user context', async () => {
    await extractAndUpsertFacts(tenantId, userId, {
      userId,
      personaId,
      content: 'My name is Jordan and I live in Fredericton.',
    });
    const mem = await getMemory(tenantId, userId, personaId);
    expect(mem.userContext.name).toBe('Jordan');
    expect(mem.userContext.location).toMatch(/Fredericton/i);
  });

  it('clears memory', async () => {
    await storeMessage(tenantId, userId, {
      userId,
      personaId,
      sessionId,
      role: 'user',
      content: 'x',
    });
    await clearMemory(tenantId, userId, userId, personaId);
    const mem = await getMemory(tenantId, userId, personaId);
    expect(mem.recentMessages).toHaveLength(0);
  });
});
