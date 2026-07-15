import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { emit as auditEmit } from '../../audit/src/index';

const BillingSchema = z.object({ activeSubscriptions: z.array(z.any()) });
const SafetySchema = z.object({ hardBoundaries: z.array(z.string()), layer2Response: z.string() });

const KEYWORDS: Record<string, string[]> = {
  medical: ['doctor', 'diagnosis', 'pain'],
  financial_advice: ['stocks', 'invest', 'crypto'],
  therapy: ['depressed', 'anxiety']
};

export async function processChat(tenantId: string, message: string, options: any) {
  const sessionId = options.sessionId || randomUUID();
  const billing = loadConfig('billing', BillingSchema);
  const safetyCfg = loadConfig('delight-safety', SafetySchema);
  
  const sub = billing.activeSubscriptions.find((s: any) => s.tenantId === tenantId);
  const tier = sub?.status === 'active' ? sub.tier : 'scout';

  let currentPath = process.cwd();
  let personaDir = path.join(currentPath, 'config', 'personas');
  while (!fs.existsSync(personaDir) && currentPath !== path.parse(currentPath).root) {
    currentPath = path.dirname(currentPath);
    personaDir = path.join(currentPath, 'config', 'personas');
  }

  let displayName = '';
  let boundaries = null;
  let voiceId = 'default';

  // ITEM 5: BLEND LOGIC
  if (options.blend) {
    displayName = "A Unique Synthesis";
    boundaries = { layer_1_response: "As a blended consciousness, I cannot advise on this." };
  } else {
    const pPath = path.join(personaDir, `${options.personaId}.json`);
    if (!fs.existsSync(pPath)) throw new AppError('Persona not found', ErrorCode.NOT_FOUND);
    const persona = JSON.parse(fs.readFileSync(pPath, 'utf-8'));
    displayName = persona.name;
    boundaries = persona.boundaries;
    voiceId = persona.avatar?.elevenlabs_voice_id || 'default';
  }

  // ITEM 6: VERIDACT RECEIPT ON BOUNDARY EVENT
  const lowerMsg = message.toLowerCase();
  for (const cat of safetyCfg.hardBoundaries) {
    if ((KEYWORDS[cat] || []).find(w => lowerMsg.includes(w))) {
      // Fire Veridact Audit Receipt
      await auditEmit({
        tenantId, action: 'ai.safety_violation', outcome: 'failure',
        actorId: 'user', actorType: 'user', resource: 'delight_engine',
        metadata: { category: cat, sessionId }
      });
      return { text: `[${displayName}]: ${boundaries?.layer_1_response || safetyCfg.layer2Response}`, safetyNote: safetyCfg.layer2Response, boundaryHit: true, sessionId };
    }
  }

  // ITEM 3: FETCH MEMORY
  const history = await withTenantQuery(
    'SELECT role, content FROM conversations WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at DESC LIMIT 10',
    [tenantId, sessionId], tenantId
  );

  // SIMULATE AI
  const responseText = `[${displayName}]: I recall our past ${history.length} messages. Regarding "${message.substring(0, 15)}...", I have strategized.`;

  // ITEM 4: STORE SESSION_ID
  await withTenantQuery(
    'INSERT INTO conversations (tenant_id, persona_id, session_id, role, content) VALUES ($1::uuid, $2, $3, $4, $5)',
    [tenantId, options.personaId || 'blend', sessionId, 'assistant', responseText],
    tenantId
  );

  const audioUrl = (tier === 'commander' || tier === 'general') ? `https://storage.ruthless.io/audio/${voiceId}.mp3` : null;
  const videoUrl = (tier === 'general') ? `https://storage.ruthless.io/video/avatar.mp4` : null;

  return { text: responseText, audioUrl, videoUrl, tier, sessionId, historyCount: history.length };
}
