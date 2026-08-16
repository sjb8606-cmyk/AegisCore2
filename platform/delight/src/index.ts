import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { loadConfig, AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };
import { withTenantQuery } from '@platform/tenancy';
import { emit as auditEmit } from '@platform/audit';
import { generateText } from '@platform/ai-gateway';

const BillingSchema = z.object({ activeSubscriptions: z.array(z.any()) });
const SafetySchema = z.object({ hardBoundaries: z.array(z.string()), layer2Response: z.string() });

const KEYWORDS: Record<string, string[]> = {
  medical: ['doctor', 'diagnosis', 'pain'],
  financial_advice: ['stocks', 'invest', 'crypto'],
  therapy: ['depressed', 'anxiety']
};

const DELIGHT_MODEL = 'llama-4-scout-17b-16e-instruct';

function buildSystemPrompt(persona: any | null, displayName: string, humanityLevel: string): string {
  if (!persona) {
    return `You are ${displayName}, a synthesis of multiple perspectives blended into one voice. Respond thoughtfully and helpfully, staying consistent with that blended identity.`;
  }
  const humanityGuidance = persona.humanity_mode?.[humanityLevel] ?? '';
  const parts = [
    `You are ${persona.name}${persona.title ? `, ${persona.title}` : ''}.`,
    persona.worldview ?? '',
    humanityGuidance,
  ].filter(Boolean);
  return parts.join('\n\n');
}

let personaIndexCache: Map<string, string> | null = null;

function buildPersonaIndex(personaDir: string): Map<string, string> {
  const index = new Map<string, string>();
  const stack = [personaDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name.endsWith('.json')) {
        index.set(entry.name.slice(0, -'.json'.length), fullPath);
      }
    }
  }
  return index;
}

export function refreshPersonaIndex(personaDir: string): void {
  personaIndexCache = buildPersonaIndex(personaDir);
}

function findPersonaFile(personaDir: string, personaId: string): string | null {
  if (!personaIndexCache) {
    personaIndexCache = buildPersonaIndex(personaDir);
  }
  return personaIndexCache.get(personaId) ?? null;
}

export function resolvePersonaDir(): string {
  let currentPath = process.cwd();
  let personaDir = path.join(currentPath, 'config', 'personas');
  while (!fs.existsSync(personaDir) && currentPath !== path.parse(currentPath).root) {
    currentPath = path.dirname(currentPath);
    personaDir = path.join(currentPath, 'config', 'personas');
  }
  return personaDir;
}

export async function processChat(tenantId: string, message: string, options: any) {
  const sessionId = options.sessionId || randomUUID();
  const billing = loadConfig('billing', BillingSchema);
  const safetyCfg = loadConfig('delight-safety', SafetySchema);

  const sub = billing.activeSubscriptions.find((s: any) => s.tenantId === tenantId);
  const tier = sub?.status === 'active' ? sub.tier : 'scout';

  const personaDir = resolvePersonaDir();

  let displayName = '';
  let boundaries = null;
  let voiceId = 'default';
  let personaData: any = null;

  if (options.blend) {
    displayName = "A Unique Synthesis";
    boundaries = { layer_1_response: "As a blended consciousness, I cannot advise on this." };
  } else {
    const pPath = findPersonaFile(personaDir, options.personaId);
    if (!pPath) throw new AppError('Persona not found', ErrorCode.NOT_FOUND);
    personaData = JSON.parse(fs.readFileSync(pPath, 'utf-8'));
    displayName = personaData.name;
    boundaries = personaData.boundaries;
    voiceId = personaData.avatar?.elevenlabs_voice_id || 'default';
  }

  const lowerMsg = message.toLowerCase();
  for (const cat of safetyCfg.hardBoundaries) {
    if ((KEYWORDS[cat] || []).find(w => lowerMsg.includes(w))) {
      await auditEmit({
        tenantId, action: 'ai.safety_violation', outcome: 'failure',
        actorId: 'user', actorType: 'user', resource: 'delight_engine',
        metadata: { category: cat, sessionId }
      });
      return { text: `[${displayName}]: ${boundaries?.layer_1_response || safetyCfg.layer2Response}`, safetyNote: safetyCfg.layer2Response, boundaryHit: true, sessionId };
    }
  }

  const historyDesc = await withTenantQuery(
    'SELECT role, content FROM conversations WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at DESC LIMIT 10',
    [tenantId, sessionId], tenantId
  );
  const history = [...historyDesc].reverse();

  const humanityLevel = options.humanityLevel ?? '25_percent';
  const systemPrompt = buildSystemPrompt(personaData, displayName, humanityLevel);

  const llmResponse = await generateText({
    provider: 'groq',
    model: DELIGHT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history.map((h: any) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: message },
    ],
    temperature: 0.8,
    maxTokens: 500,
  });

  const responseText = `[${displayName}]: ${llmResponse.content}`;

  await withTenantQuery(
    'INSERT INTO conversations (tenant_id, persona_id, session_id, role, content) VALUES ($1::uuid, $2, $3, $4, $5)',
    [tenantId, options.personaId || 'blend', sessionId, 'user', message],
    tenantId
  );
  await withTenantQuery(
    'INSERT INTO conversations (tenant_id, persona_id, session_id, role, content) VALUES ($1::uuid, $2, $3, $4, $5)',
    [tenantId, options.personaId || 'blend', sessionId, 'assistant', responseText],
    tenantId
  );

  const audioUrl = (tier === 'commander' || tier === 'general') ? `https://storage.ruthless.io/audio/${voiceId}.mp3` : null;
  const videoUrl = (tier === 'general') ? `https://storage.ruthless.io/video/avatar.mp4` : null;

  return { text: responseText, audioUrl, videoUrl, tier, sessionId, historyCount: history.length };
}
