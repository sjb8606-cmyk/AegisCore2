/**
 * platform/risk-scoring
 *
 * Dynamic 0–5 weighted risk for agent steps.
 * Pure calculation — runs on every agent step; must stay cheap/deterministic.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('risk-scoring');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  weights: z
    .object({
      cost: z.number().default(0.25),
      irreversibility: z.number().default(0.3),
      externalImpact: z.number().default(0.2),
      dataSensitivity: z.number().default(0.15),
      novelty: z.number().default(0.1),
    })
    .default({}),
  thresholds: z
    .object({
      low: z.number().default(2.0),
      medium: z.number().default(3.0),
      high: z.number().default(4.0),
    })
    .default({}),
});

export type RiskScoringConfig = z.infer<typeof ConfigSchema>;

/** Each factor is 0–5 */
export interface RiskFactors {
  cost: number;
  irreversibility: number;
  externalImpact: number;
  dataSensitivity: number;
  novelty: number;
}

export type RiskLabel = 'negligible' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskScoreResult {
  score: number;
  factors: RiskFactors;
  label: RiskLabel;
  gateFired: boolean;
  weights: RiskScoringConfig['weights'];
}

export interface RiskScoreRecord extends RiskScoreResult {
  id: string;
  tenantId: string;
  runId: string;
  step: number;
  decision: string;
  createdAt: string;
}

const records = new Map<string, RiskScoreRecord>();

export function __resetRiskScoringStore(): void {
  records.clear();
}

async function loadCfg(): Promise<RiskScoringConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('risk-scoring', ConfigSchema);
}

function clamp05(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

export function calculateRisk(
  factors: RiskFactors,
  config: RiskScoringConfig,
): RiskScoreResult {
  const f: RiskFactors = {
    cost: clamp05(factors.cost),
    irreversibility: clamp05(factors.irreversibility),
    externalImpact: clamp05(factors.externalImpact),
    dataSensitivity: clamp05(factors.dataSensitivity),
    novelty: clamp05(factors.novelty),
  };

  const w = config.weights;
  const raw =
    f.cost * w.cost +
    f.irreversibility * w.irreversibility +
    f.externalImpact * w.externalImpact +
    f.dataSensitivity * w.dataSensitivity +
    f.novelty * w.novelty;

  const score = Math.round(raw * 100) / 100;
  const t = config.thresholds;

  let label: RiskLabel;
  if (score < t.low) label = score < 1 ? 'negligible' : 'low';
  else if (score < t.medium) label = 'medium';
  else if (score < t.high) label = 'high';
  else label = 'critical';

  // Gate fires at medium and above (HITL)
  const gateFired = score >= t.medium;

  return { score, factors: f, label, gateFired, weights: w };
}

export async function scoreDecision(
  tenantId: string,
  actorId: string,
  input: {
    runId: string;
    step: number;
    decision: string;
    cost: number;
    irreversibility: number;
    externalImpact: number;
    dataSensitivity: number;
    novelty: number;
  },
): Promise<RiskScoreRecord> {
  return runCrudOperation({
    configName: 'risk-scoring',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.runId) {
        throw new AppError('runId is required', ErrorCode.BAD_REQUEST);
      }
      const result = calculateRisk(
        {
          cost: input.cost,
          irreversibility: input.irreversibility,
          externalImpact: input.externalImpact,
          dataSensitivity: input.dataSensitivity,
          novelty: input.novelty,
        },
        config,
      );

      const record: RiskScoreRecord = {
        id: crypto.randomUUID(),
        tenantId,
        runId: input.runId,
        step: input.step,
        decision: input.decision || '',
        ...result,
        createdAt: new Date().toISOString(),
      };
      records.set(record.id, record);
      logger.info(
        {
          runId: input.runId,
          step: input.step,
          score: result.score,
          label: result.label,
          gateFired: result.gateFired,
        },
        'Risk scored',
      );
      return record;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'agent_risk_score',
    meterEventType: 'api_call',
  });
}

export async function listScoresForRun(
  tenantId: string,
  runId: string,
): Promise<RiskScoreRecord[]> {
  return [...records.values()]
    .filter((r) => r.tenantId === tenantId && r.runId === runId)
    .sort((a, b) => a.step - b.step);
}
