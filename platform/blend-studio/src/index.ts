/**
 * platform/blend-studio
 *
 * Weighted multi-persona prompt mixing. No extra LLM calls —
 * pure assembly from persona-router records.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import {
  getPersona,
  assembleSystemPrompt,
  type Tier,
} from '@platform/persona-router';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('blend-studio');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxPersonasPerBlend: z.number().int().positive().default(4),
  minTier: z
    .enum(['commander', 'general', 'war_council'])
    .default('commander'),
});

export type BlendStudioConfig = z.infer<typeof ConfigSchema>;

export type BlendWeights = Record<string, number>; // personaId → weight

export interface SavedBlend {
  id: string;
  userId: string;
  name: string;
  blendWeights: BlendWeights;
  createdAt: string;
}

export interface BlendResult {
  systemPrompt: string;
  personas: { id: string; name: string; weight: number; weightPct: number }[];
  humanityLevel: number;
}

const saved = new Map<string, SavedBlend>();

export function __resetBlendStudioStore(): void {
  saved.clear();
}

async function loadCfg(): Promise<BlendStudioConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('blend-studio', ConfigSchema);
}

const TIER_RANK: Record<string, number> = {
  scout: 0,
  commander: 1,
  general: 2,
  war_council: 3,
};

function normalizeWeights(blend: BlendWeights): { id: string; weight: number }[] {
  const entries = Object.entries(blend).filter(([, w]) => w > 0);
  if (!entries.length) {
    throw new AppError('blend must include at least one weight > 0', ErrorCode.BAD_REQUEST);
  }
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) {
    throw new AppError('blend weights must sum to > 0', ErrorCode.BAD_REQUEST);
  }
  return entries
    .map(([id, weight]) => ({ id, weight: weight / total }))
    .sort((a, b) => b.weight - a.weight);
}

export function assembleBlendPrompt(
  parts: { name: string; weight: number; promptBody: string }[],
  humanityLevel: number,
): string {
  const header = [
    'You are a blended multi-persona assistant.',
    'Voice mix (higher weight = stronger influence):',
    ...parts.map(
      (p) => `- ${p.name}: ${Math.round(p.weight * 100)}%`,
    ),
    humanityLevel > 0
      ? `Humanity level: ${humanityLevel}/10 — warm accordingly.`
      : 'Humanity level: 0 — professional neutral.',
    'When personas conflict, prefer higher-weight guidance. Stay coherent.',
    '',
    '--- Persona components ---',
  ].join('\n');

  const bodies = parts
    .map(
      (p) =>
        `### \( {p.name} ( \){Math.round(p.weight * 100)}%)\n${p.promptBody}`,
    )
    .join('\n\n');

  return header + '\n\n' + bodies;
}

export async function composeBlend(
  tenantId: string,
  userId: string,
  input: {
    blend: BlendWeights;
    humanityLevel?: number;
    userTier?: Tier;
  },
): Promise<BlendResult> {
  return runCrudOperation({
    configName: 'blend-studio',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      const config = await loadCfg();
      const userTier = input.userTier || 'commander';
      if ((TIER_RANK[userTier] ?? 0) < (TIER_RANK[config.minTier] ?? 1)) {
        throw new AppError(
          `Blend Studio requires tier '${config.minTier}' or higher`,
          ErrorCode.FORBIDDEN,
        );
      }

      const normalized = normalizeWeights(input.blend);
      if (normalized.length > config.maxPersonasPerBlend) {
        throw new AppError(
          `Max ${config.maxPersonasPerBlend} personas per blend`,
          ErrorCode.BAD_REQUEST,
        );
      }

      const humanityLevel = input.humanityLevel ?? 0;
      const parts: { name: string; weight: number; promptBody: string }[] = [];
      const personasMeta: BlendResult['personas'] = [];

      for (const { id, weight } of normalized) {
        const persona = await getPersona(id);
        if (!persona || !persona.isActive) {
          throw new AppError(`Persona not found: ${id}`, ErrorCode.NOT_FOUND);
        }
        const body = assembleSystemPrompt(persona, humanityLevel, {
          recentMessages: [],
          userContext: {},
        });
        parts.push({ name: persona.name, weight, promptBody: body });
        personasMeta.push({
          id: persona.id,
          name: persona.name,
          weight,
          weightPct: Math.round(weight * 1000) / 10,
        });
      }

      const systemPrompt = assembleBlendPrompt(parts, humanityLevel);
      logger.info(
        { userId, count: parts.length },
        'Blend composed',
      );
      return { systemPrompt, personas: personasMeta, humanityLevel };
    },
    auditAction: 'data.read',
    auditResource: 'persona_blend',
    meterEventType: 'api_call',
  });
}

export async function saveBlend(
  tenantId: string,
  userId: string,
  input: { name: string; blend: BlendWeights },
): Promise<SavedBlend> {
  return runCrudOperation({
    configName: 'blend-studio',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      if (!input.name?.trim()) {
        throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      }
      normalizeWeights(input.blend); // validate
      const rec: SavedBlend = {
        id: crypto.randomUUID(),
        userId,
        name: input.name.trim(),
        blendWeights: input.blend,
        createdAt: new Date().toISOString(),
      };
      saved.set(rec.id, rec);
      return rec;
    },
    auditAction: 'data.created',
    auditResource: 'saved_blend',
    meterEventType: 'api_call',
  });
}

export async function listSavedBlends(
  userId: string,
): Promise<SavedBlend[]> {
  return [...saved.values()].filter((b) => b.userId === userId);
}
