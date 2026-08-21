/**
 * platform/persona-memory
 *
 * Per user+persona conversation history + long-term fact store.
 * Fact extraction is rule-based mock (LLM extractor plugs in later).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('persona-memory');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  recentMessageLimit: z.number().int().positive().default(10),
  factExtractionEnabled: z.boolean().default(true),
});

export type PersonaMemoryConfig = z.infer<typeof ConfigSchema>;

export interface ConversationMessage {
  id: string;
  userId: string;
  personaId: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  humanityLevel: number;
  createdAt: string;
}

export interface UserContextFact {
  id: string;
  userId: string;
  personaId: string;
  key: string;
  value: string;
  updatedAt: string;
}

const messages = new Map<string, ConversationMessage[]>(); // `\( {userId}: \){personaId}`
const facts = new Map<string, Map<string, UserContextFact>>(); // same key → key→fact

export function __resetPersonaMemoryStore(): void {
  messages.clear();
  facts.clear();
}

function memKey(userId: string, personaId: string): string {
  return `\( {userId}: \){personaId}`;
}

async function loadCfg(): Promise<PersonaMemoryConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('persona-memory', ConfigSchema);
}

/** Simple fact extractor — "My name is X" / "I live in Y" patterns */
export function extractFactsFromMessage(
  content: string,
): { key: string; value: string }[] {
  const found: { key: string; value: string }[] = [];
  const name = content.match(/\b(?:my name is|i'm|i am)\s+([A-Z][a-zA-Z'-]+)/i);
  if (name) found.push({ key: 'name', value: name[1] });
  const live = content.match(/\b(?:i live in|i'm from|i am from)\s+([A-Za-z\s]+?)(?:\.|$)/i);
  if (live) found.push({ key: 'location', value: live[1].trim() });
  const goal = content.match(/\b(?:my goal is|i want to|i'm trying to)\s+(.+?)(?:\.|$)/i);
  if (goal) found.push({ key: 'goal', value: goal[1].trim() });
  return found;
}

export async function getMemory(
  tenantId: string,
  userId: string,
  personaId: string,
): Promise<{
  recentMessages: ConversationMessage[];
  userContext: Record<string, string>;
}> {
  const config = await loadCfg();
  const key = memKey(userId, personaId);
  const all = messages.get(key) || [];
  const recentMessages = all.slice(-config.recentMessageLimit);
  const fmap = facts.get(key) || new Map();
  const userContext: Record<string, string> = {};
  for (const [k, f] of fmap) userContext[k] = f.value;
  return { recentMessages, userContext };
}

export async function storeMessage(
  tenantId: string,
  actorId: string,
  input: {
    userId: string;
    personaId: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    humanityLevel?: number;
  },
): Promise<ConversationMessage> {
  return runCrudOperation({
    configName: 'persona-memory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.content?.trim()) {
        throw new AppError('content is required', ErrorCode.BAD_REQUEST);
      }
      if (!input.userId || !input.personaId || !input.sessionId) {
        throw new AppError(
          'userId, personaId, sessionId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const msg: ConversationMessage = {
        id: crypto.randomUUID(),
        userId: input.userId,
        personaId: input.personaId,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content.trim(),
        humanityLevel: input.humanityLevel ?? 0,
        createdAt: new Date().toISOString(),
      };
      const key = memKey(input.userId, input.personaId);
      const list = messages.get(key) || [];
      list.push(msg);
      messages.set(key, list);
      return msg;
    },
    auditAction: 'data.created',
    auditResource: 'persona_message',
    meterEventType: 'api_call',
  });
}

export async function extractAndUpsertFacts(
  tenantId: string,
  actorId: string,
  input: { userId: string; personaId: string; content: string },
): Promise<UserContextFact[]> {
  return runCrudOperation({
    configName: 'persona-memory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!config.factExtractionEnabled) return [];

      const extracted = extractFactsFromMessage(input.content);
      const key = memKey(input.userId, input.personaId);
      if (!facts.has(key)) facts.set(key, new Map());
      const fmap = facts.get(key)!;
      const upserted: UserContextFact[] = [];

      for (const f of extracted) {
        const fact: UserContextFact = {
          id: fmap.get(f.key)?.id || crypto.randomUUID(),
          userId: input.userId,
          personaId: input.personaId,
          key: f.key,
          value: f.value,
          updatedAt: new Date().toISOString(),
        };
        fmap.set(f.key, fact);
        upserted.push(fact);
      }
      logger.debug(
        { userId: input.userId, count: upserted.length },
        'Facts extracted',
      );
      return upserted;
    },
    auditAction: 'data.updated',
    auditResource: 'persona_user_context',
    meterEventType: 'api_call',
  });
}

export async function clearMemory(
  tenantId: string,
  actorId: string,
  userId: string,
  personaId: string,
): Promise<{ cleared: boolean }> {
  return runCrudOperation({
    configName: 'persona-memory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const key = memKey(userId, personaId);
      messages.delete(key);
      facts.delete(key);
      return { cleared: true };
    },
    auditAction: 'data.deleted',
    auditResource: 'persona_memory',
    meterEventType: 'api_call',
  });
}

/** Adapter for persona-router setMemoryLoader */
export async function memoryLoaderAdapter(
  userId: string,
  personaId: string,
): Promise<{
  recentMessages: { role: string; content: string }[];
  userContext: Record<string, string>;
}> {
  const mem = await getMemory('system', userId, personaId);
  return {
    recentMessages: mem.recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    userContext: mem.userContext,
  };
}
