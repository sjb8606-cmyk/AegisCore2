import fs from 'fs';
import { resolvePersonaDir } from '@platform/delight';
import { resolveCapabilities, canActAsBot, canActAsAgent } from './index';
import { createAgentDefinition, initiateRun } from '@platform/ai-agents';
import { AppError, ErrorCode } from '@platform/utils';

// Loads a persona file directly by id (thin, dispatcher-only — not the cached
// index used by chat, to keep this module independent and easy to test).
function loadPersonaById(personaId: string): any {
  const dir = resolvePersonaDir();
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = `${cur}/${entry.name}`;
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (entry.name === `${personaId}.json`) {
        return JSON.parse(fs.readFileSync(full, 'utf-8'));
      }
    }
  }
  throw new AppError('Persona not found', ErrorCode.NOT_FOUND);
}

export type DispatchMode = 'chatbot' | 'bot' | 'agent';

// Single entry point: given a personaId and requested mode, checks the
// persona's own capabilities flags before doing anything. A persona with
// agent.enabled === false can never be routed into agent mode, regardless
// of what the caller asks for.
export async function dispatchPersona(
  tenantId: string,
  personaId: string,
  mode: DispatchMode,
  payload: { message?: string; userId?: string; input?: string }
) {
  const persona = loadPersonaById(personaId);
  const caps = resolveCapabilities(persona);

  if (mode === 'bot') {
    if (!canActAsBot(caps)) {
      throw new AppError(`Persona ${personaId} does not have bot mode enabled`, ErrorCode.FORBIDDEN);
    }
    return {
      mode: 'bot',
      personaId,
      permissionScope: caps.bot.permissionScope,
      triggerConditions: caps.bot.triggerConditions,
      status: 'bot_dispatch_acknowledged',
    };
  }

  if (mode === 'agent') {
    if (!canActAsAgent(caps)) {
      throw new AppError(`Persona ${personaId} does not have agent mode enabled`, ErrorCode.FORBIDDEN);
    }
    const definition = await createAgentDefinition(tenantId, {
      name: persona.name,
      description: `Agent instance of persona ${personaId}`,
      system_prompt: persona.worldview ?? '',
      persona_id: personaId,
    });
    const run = await initiateRun(tenantId, definition.id, payload.input || payload.message || '', payload.userId || 'system');
    return { mode: 'agent', personaId, definition, run };
  }

  // chatbot mode is intentionally not re-implemented here — it stays owned
  // by @platform/delight's processChat, which already handles it correctly.
  throw new AppError('Use @platform/delight processChat for chatbot mode', ErrorCode.BAD_REQUEST);
}
