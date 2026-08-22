/**
 * platform/data-chatbot
 *
 * Support bot scoped to product domain data.
 * retrieve context → generate (injectable) → log exchange → optional escalate.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('data-chatbot');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  systemPrompt: z
    .string()
    .default(
      'You are a helpful support assistant. Answer only from the provided context. If unsure, say you do not know.',
    ),
  knowledgeScope: z.array(z.string()).default(['products', 'orders', 'docs']),
  maxContextItems: z.number().int().positive().default(8),
  escalateKeywords: z
    .array(z.string())
    .default(['speak to human', 'agent', 'manager', 'complaint']),
  maxHistoryTurns: z.number().int().positive().default(20),
});

export interface KnowledgeItem {
  id: string;
  tenantId: string;
  scope: string;
  title: string;
  body: string;
  tags: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  at: string;
}

export interface ChatSession {
  id: string;
  tenantId: string;
  userId: string;
  messages: ChatMessage[];
  escalated: boolean;
  createdAt: string;
  updatedAt: string;
}

type RetrieveFn = (
  tenantId: string,
  query: string,
  scopes: string[],
  limit: number,
) => Promise<KnowledgeItem[]>;

type GenerateFn = (
  systemPrompt: string,
  context: KnowledgeItem[],
  history: ChatMessage[],
  userMessage: string,
) => Promise<string>;

const knowledge = new Map<string, KnowledgeItem>();
const sessions = new Map<string, ChatSession>();

let retrieveFn: RetrieveFn = async (tenantId, query, scopes, limit) => {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  return [...knowledge.values()]
    .filter((k) => {
      if (k.tenantId !== tenantId || !scopes.includes(k.scope)) return false;
      const hay = (
        k.title +
        ' ' +
        k.body +
        ' ' +
        k.tags.join(' ')
      ).toLowerCase();
      if (!tokens.length) return hay.includes(query.toLowerCase());
      return tokens.some((w) => hay.includes(w));
    })
    .slice(0, limit);
};

let generateFn: GenerateFn = async (systemPrompt, context, _history, userMessage) => {
  if (!context.length) {
    return "I don't have enough information in the knowledge base to answer that.";
  }
  const snippets = context
    .map((c) => '- ' + c.title + ': ' + c.body.slice(0, 200))
    .join('\n');
  return (
    'Based on our records:\n' +
    snippets +
    '\n\n(Regarding: ' +
    userMessage.slice(0, 80) +
    ')'
  );
};

export function __resetDataChatbotStore(): void {
  knowledge.clear();
  sessions.clear();
  retrieveFn = async (tenantId, query, scopes, limit) => {
    const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  return [...knowledge.values()]
    .filter((k) => {
      if (k.tenantId !== tenantId || !scopes.includes(k.scope)) return false;
      const hay = (k.title + ' ' + k.body + ' ' + k.tags.join(' ')).toLowerCase();
      if (!tokens.length) return hay.includes(query.toLowerCase());
      return tokens.some((w) => hay.includes(w));
    })
    .slice(0, limit);
  };
  generateFn = async (_s, context, _h, userMessage) => {
    if (!context.length) {
      return "I don't have enough information in the knowledge base to answer that.";
    }
    const snippets = context
      .map((c) => '- ' + c.title + ': ' + c.body.slice(0, 200))
      .join('\n');
    return (
      'Based on our records:\n' +
      snippets +
      '\n\n(Regarding: ' +
      userMessage.slice(0, 80) +
      ')'
    );
  };
}

export function setRetrieveFn(fn: RetrieveFn): void {
  retrieveFn = fn;
}
export function setGenerateFn(fn: GenerateFn): void {
  generateFn = fn;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('data-chatbot', ConfigSchema);
}

export function shouldEscalate(
  message: string,
  keywords: string[],
): boolean {
  const lower = message.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

export async function indexKnowledge(
  tenantId: string,
  actorId: string,
  input: {
    scope: string;
    title: string;
    body: string;
    tags?: string[];
  },
): Promise<KnowledgeItem> {
  return runCrudOperation({
    configName: 'data-chatbot',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.scope || !input.title || !input.body) {
        throw new AppError(
          'scope, title, body required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const item: KnowledgeItem = {
        id: crypto.randomUUID(),
        tenantId,
        scope: input.scope,
        title: input.title.trim(),
        body: input.body.trim(),
        tags: input.tags || [],
      };
      knowledge.set(item.id, item);
      return item;
    },
    auditAction: 'data.created',
    auditResource: 'chatbot_knowledge',
    meterEventType: 'api_call',
  });
}

export async function startSession(
  tenantId: string,
  actorId: string,
  userId: string,
): Promise<ChatSession> {
  return runCrudOperation({
    configName: 'data-chatbot',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const now = new Date().toISOString();
      const session: ChatSession = {
        id: crypto.randomUUID(),
        tenantId,
        userId,
        messages: [],
        escalated: false,
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(session.id, session);
      return session;
    },
    auditAction: 'data.created',
    auditResource: 'chatbot_session',
    meterEventType: 'api_call',
  });
}

export async function chat(
  tenantId: string,
  actorId: string,
  input: { sessionId: string; message: string },
): Promise<{
  reply: string;
  escalated: boolean;
  contextUsed: number;
  session: ChatSession;
}> {
  return runCrudOperation({
    configName: 'data-chatbot',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const session = sessions.get(input.sessionId);
      if (!session || session.tenantId !== tenantId) {
        throw new AppError('Session not found', ErrorCode.NOT_FOUND);
      }
      if (!input.message?.trim()) {
        throw new AppError('message required', ErrorCode.BAD_REQUEST);
      }
      if (session.escalated) {
        throw new AppError(
          'Session escalated to human',
          ErrorCode.CONFLICT,
        );
      }

      const now = new Date().toISOString();
      session.messages.push({
        role: 'user',
        content: input.message.trim(),
        at: now,
      });

      if (shouldEscalate(input.message, config.escalateKeywords)) {
        session.escalated = true;
        const reply =
          'I am connecting you with a human agent. Please hold.';
        session.messages.push({ role: 'assistant', content: reply, at: now });
        session.updatedAt = now;
        sessions.set(session.id, session);
        return { reply, escalated: true, contextUsed: 0, session };
      }

      const context = await retrieveFn(
        tenantId,
        input.message,
        config.knowledgeScope,
        config.maxContextItems,
      );
      const reply = await generateFn(
        config.systemPrompt,
        context,
        session.messages,
        input.message,
      );
      session.messages.push({
        role: 'assistant',
        content: reply,
        at: new Date().toISOString(),
      });
      if (session.messages.length > config.maxHistoryTurns * 2) {
        session.messages = session.messages.slice(
          -config.maxHistoryTurns * 2,
        );
      }
      session.updatedAt = new Date().toISOString();
      sessions.set(session.id, session);
      logger.info(
        { sessionId: session.id, contextUsed: context.length },
        'Chat turn',
      );
      return {
        reply,
        escalated: false,
        contextUsed: context.length,
        session,
      };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'chatbot_turn',
    meterEventType: 'api_call',
  });
}

export async function getSession(
  tenantId: string,
  sessionId: string,
): Promise<ChatSession | null> {
  const s = sessions.get(sessionId);
  if (!s || s.tenantId !== tenantId) return null;
  return s;
}
