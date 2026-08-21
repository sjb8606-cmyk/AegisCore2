/**
 * platform/ai-generation — image / music / video adapters (mock provider).
 */
import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };
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

function mockComplete(kind: GenerationResult['kind'], prompt: string, provider: string): GenerationResult {
  const id = crypto.randomUUID();
  const rec: GenerationResult = {
    id,
    kind,
    prompt,
    url: `https://cdn.mock/\( {kind}/ \){id.slice(0, 8)}.${kind === 'image' ? 'png' : kind === 'music' ? 'mp3' : 'mp4'}`,
    provider,
    createdAt: new Date().toISOString(),
  };
  results.set(id, rec);
  return rec;
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
      const rec = mockComplete(kind, prompt.trim(), config.provider);
      logger.info({ kind, id: rec.id }, 'Generation complete');
      return rec;
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
