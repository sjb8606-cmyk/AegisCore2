/**
 * platform/ai-generation — image / music / video adapters.
 * Real providers are not yet wired. All generation paths throw NOT_IMPLEMENTED.
 */

import { z } from 'zod';
import { AppError, ErrorCode } from '@platform/utils';
import { runCrudOperation } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

const logger = getLogger('ai-generation');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z.enum(['mock', 'openai', 'stability', 'replicate']).default('mock'),
  limits: z.object({
    maxPromptChars: z.number().default(2000),
    generationsPerDay: z.number().default(50),
  }).default({}),
});

export interface GenerationResult {
  id: string;
  kind: 'image' | 'music' | 'video';
  prompt: string;
  url: string;
  provider: string;
  createdAt: string;
}

const results = new Map<string, GenerationResult>();

export function __resetAiGenerationStore(): void {
  results.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('ai-generation', ConfigSchema);
}

async function generate(
  tenantId: string,
  actorId: string,
  kind: GenerationResult['kind'],
  prompt: string,
): Promise<GenerationResult> {
  return runCrudOperation({
    configName: 'ai-generation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!prompt?.trim()) throw new AppError('prompt is required', ErrorCode.BAD_REQUEST);
      if (prompt.length > config.limits.maxPromptChars) {
        throw new AppError('prompt too long', ErrorCode.BAD_REQUEST);
      }

      // Real provider adapters are not yet implemented.
      throw new AppError(
        `NOT_IMPLEMENTED: generate${kind} — real ${config.provider} provider is not wired yet.`,
        'NOT_IMPLEMENTED'
      );
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ai_generation',
    meterEventType: 'api_call',
  });
}

export async function generateImage(tenantId: string, actorId: string, prompt: string) {
  return generate(tenantId, actorId, 'image', prompt);
}
export async function generateMusic(tenantId: string, actorId: string, prompt: string) {
  return generate(tenantId, actorId, 'music', prompt);
}
export async function generateVideoFromPrompt(tenantId: string, actorId: string, prompt: string) {
  return generate(tenantId, actorId, 'video', prompt);
}

export function getGeneration(id: string): GenerationResult | null {
  return results.get(id) || null;
}
