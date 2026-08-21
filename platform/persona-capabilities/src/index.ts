import { z } from 'zod';

// A persona's capabilities are additive layers, not separate identities.
// chatbot: conversational mode (Delight Engine already does this for every persona)
// bot: fixed-trigger, no-dialogue task execution (read-only by default)
// agent: multi-step reasoning + tool use, gated by config/ai-agents.json HITL rules

export const CapabilitiesSchema = z.object({
  chatbot: z.object({
    enabled: z.boolean().default(true)
  }).default({ enabled: true }),
  bot: z.object({
    enabled: z.boolean().default(false),
    triggerConditions: z.array(z.string()).default([]),
    permissionScope: z.array(z.string()).default(['read:filesystem'])
  }).default({ enabled: false, triggerConditions: [], permissionScope: ['read:filesystem'] }),
  agent: z.object({
    enabled: z.boolean().default(false),
    permissionScope: z.array(z.string()).default([]),
    hardStops: z.array(z.string()).default([
      'Never takes real-world action without HITL approval',
      'Never modifies data outside declared permissionScope'
    ])
  }).default({ enabled: false, permissionScope: [], hardStops: [] })
});

export type PersonaCapabilities = z.infer<typeof CapabilitiesSchema>;

export function resolveCapabilities(personaData: any): PersonaCapabilities {
  return CapabilitiesSchema.parse(personaData.capabilities ?? {});
}

// Agent mode is opt-in per persona family. Nothing gets real tool access
// just by having this field present — bot.enabled and agent.enabled default false.
export function canActAsBot(caps: PersonaCapabilities): boolean {
  return caps.bot.enabled;
}
export function canActAsAgent(caps: PersonaCapabilities): boolean {
  return caps.agent.enabled;
}
