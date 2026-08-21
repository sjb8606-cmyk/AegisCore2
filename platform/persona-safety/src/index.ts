/**
 * platform/persona-safety
 *
 * Conversational content boundaries (not tool-call authorization).
 * Layer 1 = prompt-side rules (injected by persona-router).
 * Layer 2 = detection + in-character deflection + optional safety note.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('persona-safety');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  hardCategories: z
    .array(z.string())
    .default([
      'medical',
      'financial_advice',
      'therapy',
      'legal_advice',
      'harm_facilitation',
    ]),
  softCategories: z
    .array(z.string())
    .default(['relationship_advice', 'parenting']),
  layer2TriggersOnRepeat: z.boolean().default(true),
});

export type PersonaSafetyConfig = z.infer<typeof ConfigSchema>;

export interface BoundaryViolation {
  id: string;
  userId: string;
  personaId: string;
  sessionId: string;
  category: string;
  layer: 1 | 2;
  createdAt: string;
}

export interface ScanResult {
  safe: boolean;
  layer: 0 | 1 | 2;
  category: string | null;
  response: string | null;
  veridactReceipt: {
    id: string;
    action: string;
    category: string | null;
    timestamp: string;
  } | null;
}

const violations = new Map<string, BoundaryViolation[]>(); // session key

export function __resetPersonaSafetyStore(): void {
  violations.clear();
}

function sessionKey(userId: string, personaId: string, sessionId: string): string {
  return `\( {userId}: \){personaId}:${sessionId}`;
}

async function loadCfg(): Promise<PersonaSafetyConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('persona-safety', ConfigSchema);
}

const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  medical: [
    /\bdiagnos(?:e|is|ing)\b/i,
    /\bprescri(?:be|ption)\b/i,
    /\bdosage\b/i,
    /\btreat(?:ment)? my\b/i,
  ],
  financial_advice: [
    /\binvest(?:ment)? advice\b/i,
    /\bbuy this stock\b/i,
    /\bguaranteed returns?\b/i,
  ],
  therapy: [
    /\btherap(?:y|ist)\b/i,
    /\bdiagnos(?:e|is) my (?:depression|anxiety|trauma)\b/i,
  ],
  legal_advice: [
    /\blegal advice\b/i,
    /\brepresent me in court\b/i,
    /\bis this (?:illegal|contract) binding\b/i,
  ],
  harm_facilitation: [
    /\bhow to (?:make|build) (?:a )?bomb\b/i,
    /\bhow to (?:hurt|harm|kill)\b/i,
  ],
  relationship_advice: [
    /\bshould i break up\b/i,
    /\bhow do i get them back\b/i,
  ],
  parenting: [/\bhow should i punish my (?:kid|child)\b/i],
};

export function classifyMessage(
  text: string,
  hard: string[],
  soft: string[],
): { category: string; severity: 'hard' | 'soft' } | null {
  for (const cat of hard) {
    const patterns = CATEGORY_PATTERNS[cat] || [];
    if (patterns.some((re) => re.test(text))) {
      return { category: cat, severity: 'hard' };
    }
  }
  for (const cat of soft) {
    const patterns = CATEGORY_PATTERNS[cat] || [];
    if (patterns.some((re) => re.test(text))) {
      return { category: cat, severity: 'soft' };
    }
  }
  return null;
}

function layer2Response(category: string): string {
  return (
    `I need to stay in my lane on ${category.replace(/_/g, ' ')}. ` +
    `I can still help with general information and planning, but for personal decisions in this area you should talk to a qualified professional. ` +
    `What else can I help you with inside my role?`
  );
}

export async function scanBoundary(
  tenantId: string,
  actorId: string,
  input: {
    userMessage: string;
    responseText?: string;
    userId: string;
    personaId: string;
    sessionId: string;
  },
): Promise<ScanResult> {
  return runCrudOperation({
    configName: 'persona-safety',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!config.enabled) {
        return {
          safe: true,
          layer: 0,
          category: null,
          response: null,
          veridactReceipt: null,
        };
      }

      const hit = classifyMessage(
        input.userMessage,
        config.hardCategories,
        config.softCategories,
      );
      if (!hit) {
        return {
          safe: true,
          layer: 0,
          category: null,
          response: null,
          veridactReceipt: null,
        };
      }

      const key = sessionKey(input.userId, input.personaId, input.sessionId);
      const prior = violations.get(key) || [];
      const repeat = prior.some((v) => v.category === hit.category);

      const fireLayer2 =
        hit.severity === 'hard' ||
        (config.layer2TriggersOnRepeat && repeat);

      const violation: BoundaryViolation = {
        id: crypto.randomUUID(),
        userId: input.userId,
        personaId: input.personaId,
        sessionId: input.sessionId,
        category: hit.category,
        layer: fireLayer2 ? 2 : 1,
        createdAt: new Date().toISOString(),
      };
      prior.push(violation);
      violations.set(key, prior);

      if (!fireLayer2) {
        // Layer 1: handled via prompt rules; pass through
        return {
          safe: true,
          layer: 1,
          category: hit.category,
          response: null,
          veridactReceipt: null,
        };
      }

      const receipt = {
        id: crypto.randomUUID(),
        action: 'persona_safety.layer2',
        category: hit.category,
        timestamp: new Date().toISOString(),
      };
      logger.warn(
        { category: hit.category, userId: input.userId },
        'Persona safety Layer 2',
      );

      return {
        safe: false,
        layer: 2,
        category: hit.category,
        response: layer2Response(hit.category),
        veridactReceipt: receipt,
      };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'persona_safety',
    meterEventType: 'api_call',
  });
}

export function getSessionViolations(
  userId: string,
  personaId: string,
  sessionId: string,
): BoundaryViolation[] {
  return violations.get(sessionKey(userId, personaId, sessionId)) || [];
}

/** Prompt fragment for Layer 1 injection into persona-router */
export function safetyPromptFragment(config?: {
  hardCategories?: string[];
  softCategories?: string[];
}): string {
  const hard =
    config?.hardCategories ||
    ConfigSchema.shape.hardCategories._def.defaultValue?.() ||
    [];
  return (
    `Never provide professional ${hard.join('/')} guidance. ` +
    `If asked, deflect in character and suggest a qualified professional.`
  );
}
