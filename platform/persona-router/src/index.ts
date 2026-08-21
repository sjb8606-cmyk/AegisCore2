import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('persona-router');
const Tiers = ['scout', 'commander', 'general', 'war_council'] as const;
export type Tier = (typeof Tiers)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  tierOrder: z.array(z.enum(Tiers)).default([...Tiers]),
  defaultHumanityLevel: z.number().min(0).max(10).default(0),
});

export interface PersonaRecord {
  id: string;
  name: string;
  category: string;
  jsonConfig: {
    identity?: string;
    domain?: string;
    pantheon?: string;
    responsePattern?: string;
    safetyNotes?: string;
    [k: string]: unknown;
  };
  tierRequired: Tier;
  isActive: boolean;
}

const personas = new Map<string, PersonaRecord>();
const userTiers = new Map<string, Tier>();

function seedDemoPersonas(): void {
  personas.set('persona-scout-guide', {
    id: 'persona-scout-guide',
    name: 'Scout Guide',
    category: 'support',
    jsonConfig: {
      identity: 'You are Scout Guide, a clear and practical assistant.',
      domain: 'General productivity and planning.',
      responsePattern: 'Be concise. Prefer bullet steps when helpful.',
      safetyNotes: 'Do not give medical, legal, or financial advice.',
    },
    tierRequired: 'scout',
    isActive: true,
  });
  personas.set('persona-commander', {
    id: 'persona-commander',
    name: 'Commander',
    category: 'strategy',
    jsonConfig: {
      identity: 'You are Commander, a decisive strategic advisor.',
      domain: 'Operations and prioritization.',
      pantheon: 'War council archetypes: clarity over noise.',
      responsePattern: 'Lead with the recommendation, then rationale.',
      safetyNotes: 'No therapy, medical diagnosis, or legal advice.',
    },
    tierRequired: 'commander',
    isActive: true,
  });
}

export function __resetPersonaRouterStore(): void {
  personas.clear();
  userTiers.clear();
  seedDemoPersonas();
}

export function __setUserTier(userId: string, tier: Tier): void {
  userTiers.set(userId, tier);
}

// seed on module load
seedDemoPersonas();

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('persona-router', ConfigSchema);
}

function tierRank(tier: Tier, order: Tier[]): number {
  const i = order.indexOf(tier);
  return i < 0 ? 0 : i;
}

function humanityBlock(level: number): string {
  if (level <= 0) return 'Humanity mode: neutral, professional tone.';
  if (level <= 3) return 'Humanity mode: warm and approachable, still precise.';
  if (level <= 7) return 'Humanity mode: empathetic and conversational.';
  return 'Humanity mode: highly personal and supportive, stay within safety bounds.';
}

export function assembleSystemPrompt(
  persona: PersonaRecord,
  humanityLevel: number,
  memory: {
    recentMessages: { role: string; content: string }[];
    userContext: Record<string, string>;
  },
  safetyExtra?: string,
): string {
  const c = (persona && persona.jsonConfig) || {};
  const parts: string[] = [];

  if (c.identity) parts.push(String(c.identity));
  else if (persona && persona.name) parts.push('You are ' + persona.name + '.');

  if (c.domain) parts.push('Domain:\n' + String(c.domain));
  if (c.pantheon) parts.push('Pantheon:\n' + String(c.pantheon));
  parts.push(humanityBlock(humanityLevel));
  if (c.safetyNotes) parts.push('Safety:\n' + String(c.safetyNotes));
  if (safetyExtra) parts.push('Safety boundary rules:\n' + safetyExtra);

  const ctx = (memory && memory.userContext) || {};
  const ctxKeys = Object.keys(ctx);
  if (ctxKeys.length) {
    parts.push(
      'Known user context:\n' +
        ctxKeys.map((k) => '- ' + k + ': ' + ctx[k]).join('\n'),
    );
  }
  const recent = (memory && memory.recentMessages) || [];
  if (recent.length) {
    parts.push(
      'Recent conversation:\n' +
        recent.map((m) => m.role + ': ' + m.content).join('\n'),
    );
  }
  if (c.responsePattern) {
    parts.push('Response pattern:\n' + String(c.responsePattern));
  }
  return parts.join('\n\n');
}

export async function routePersona(
  tenantId: string,
  userId: string,
  input: { personaId: string; humanityLevel?: number; userTier?: Tier },
) {
  return runCrudOperation({
    configName: 'persona-router',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      const config = await loadCfg();
      const persona = personas.get(input.personaId);
      if (!persona || !persona.isActive) {
        throw new AppError('Persona not found or inactive', ErrorCode.NOT_FOUND);
      }
      const userTier =
        input.userTier || userTiers.get(userId) || ('scout' as Tier);
      if (
        tierRank(userTier, config.tierOrder) <
        tierRank(persona.tierRequired, config.tierOrder)
      ) {
        throw new AppError(
          `Tier '\( {userTier}' insufficient for persona requiring ' \){persona.tierRequired}'`,
          ErrorCode.FORBIDDEN,
        );
      }
      const humanityLevel =
        input.humanityLevel ?? config.defaultHumanityLevel;
      const memory = { recentMessages: [] as any[], userContext: {} as Record<string, string> };
      const systemPrompt = assembleSystemPrompt(persona, humanityLevel, memory);
      logger.info({ personaId: persona.id }, 'Persona routed');
      return { persona, systemPrompt, memory, humanityLevel };
    },
    auditAction: 'data.read',
    auditResource: 'persona_route',
    meterEventType: 'api_call',
  });
}

export function getPersona(personaId: string): PersonaRecord | null {
  return personas.get(personaId) || null;
}

export function listPersonas() {
  return [...personas.values()].filter((p) => p.isActive);
}
