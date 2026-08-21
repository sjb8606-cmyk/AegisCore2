/**
 * platform/planner-agent
 *
 * NL intent → structured findMatches call.
 * Mock planner for tests; reasoningProvider reserved for real LLM.
 * Every step logged to worm-audit.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { listEntities } from '@platform/planner-entities';
import { findMatches, type MatchCandidate } from '@platform/planner-matching';
import { appendAudit } from '@platform/worm-audit';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('planner-agent');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  reasoningProvider: z
    .enum(['mock', 'anthropic', 'openai', 'groq'])
    .default('mock'),
  maxToolCallsPerRequest: z.number().int().positive().default(3),
  defaultNiche: z.string().default('pet-foster'),
  defaultWindowHours: z.number().positive().default(48),
});

export type PlannerAgentConfig = z.infer<typeof ConfigSchema>;

export interface ParsedIntent {
  entityNameHint: string | null;
  windowStart: string;
  windowEnd: string;
  niche: string;
}

export interface PlannerAgentResult {
  id: string;
  tenantId: string;
  prompt: string;
  intent: ParsedIntent;
  entityId: string | null;
  matches: MatchCandidate[];
  steps: { tool: string; detail: string }[];
  createdAt: string;
}

/**
 * Mock intent parser — extract a name-like token and default time window.
 */
export function parsePlannerIntent(
  prompt: string,
  config: { defaultNiche: string; defaultWindowHours: number },
): ParsedIntent {
  const p = prompt.trim();
  // "watch Max this weekend" / "help with Max" → Max
  const nameMatch =
    p.match(
      /\b(?:watch|care for|help with|cover|sit for|pickup|pick up)\s+([A-Z][a-zA-Z'-]+)/,
    ) ||
    p.match(/\bfor\s+([A-Z][a-zA-Z'-]+)\b/) ||
    p.match(/\b([A-Z][a-zA-Z'-]{2,})\b/);

  const now = Date.now();
  let windowHours = config.defaultWindowHours;
  if (/weekend/i.test(p)) windowHours = 72;
  if (/tomorrow/i.test(p)) windowHours = 24;
  if (/tuesday|monday|wednesday|thursday|friday|saturday|sunday/i.test(p)) {
    windowHours = 36;
  }

  return {
    entityNameHint: nameMatch ? nameMatch[1] : null,
    windowStart: new Date(now).toISOString(),
    windowEnd: new Date(now + windowHours * 3600_000).toISOString(),
    niche: config.defaultNiche,
  };
}

const results = new Map<string, PlannerAgentResult>();

export function __resetPlannerAgentStore(): void {
  results.clear();
}

async function loadCfg(): Promise<PlannerAgentConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('planner-agent', ConfigSchema);
}

export async function queryPlannerAgent(
  tenantId: string,
  userId: string,
  prompt: string,
): Promise<PlannerAgentResult> {
  return runCrudOperation({
    configName: 'planner-agent',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      const config = await loadCfg();
      const text = (prompt || '').trim();
      if (!text) throw new AppError('prompt is required', ErrorCode.BAD_REQUEST);

      const steps: { tool: string; detail: string }[] = [];
      const intent = parsePlannerIntent(text, config);
      steps.push({
        tool: 'parse_intent',
        detail: JSON.stringify(intent),
      });

      await appendAudit(tenantId, userId, {
        action: 'planner_agent.parse_intent',
        entityType: 'planner_agent_query',
        entityId: 'pending',
        changes: intent as unknown as Record<string, unknown>,
      });

      // Resolve entity by name hint
      let entityId: string | null = null;
      const entities = await listEntities(tenantId, { niche: intent.niche });
      if (intent.entityNameHint) {
        const hit = entities.find(
          (e) =>
            e.name.toLowerCase() === intent.entityNameHint!.toLowerCase(),
        );
        if (hit) entityId = hit.id;
      }
      if (!entityId && entities.length === 1) {
        entityId = entities[0].id;
      }
      if (!entityId && entities.length) {
        // prefer available
        const avail = entities.find((e) => e.status === 'available');
        entityId = avail?.id || entities[0].id;
      }

      steps.push({
        tool: 'resolve_entity',
        detail: entityId || 'none',
      });

      let matches: MatchCandidate[] = [];
      if (entityId) {
        matches = await findMatches(tenantId, userId, {
          entityId,
          windowStart: intent.windowStart,
          windowEnd: intent.windowEnd,
          niche: intent.niche,
          limit: 5,
        });
        steps.push({
          tool: 'find_matches',
          detail: `${matches.length} candidates`,
        });
      }

      if (steps.length > config.maxToolCallsPerRequest) {
        steps.length = config.maxToolCallsPerRequest;
      }

      const id = crypto.randomUUID();
      const result: PlannerAgentResult = {
        id,
        tenantId,
        prompt: text,
        intent,
        entityId,
        matches,
        steps,
        createdAt: new Date().toISOString(),
      };
      results.set(id, result);

      await appendAudit(tenantId, userId, {
        action: 'planner_agent.query_complete',
        entityType: 'planner_agent_query',
        entityId: id,
        changes: {
          matchCount: matches.length,
          entityId,
        },
      });

      logger.info(
        { queryId: id, matchCount: matches.length },
        'Planner agent query complete',
      );
      return result;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'planner_agent',
    meterEventType: 'api_call',
  });
}

export async function getPlannerAgentResult(
  tenantId: string,
  id: string,
): Promise<PlannerAgentResult | null> {
  const r = results.get(id);
  if (!r || r.tenantId !== tenantId) return null;
  return r;
}
