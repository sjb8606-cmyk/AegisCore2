/**
 * platform/aegis-swarm/src/employees/risk-analyst.ts
 *
 * E-19 — Risk Analyst.
 *
 * Real, standard likelihood x impact risk matrix — genuine
 * deterministic scoring (1-5 x 1-5 = 1-25), banded into
 * low/medium/high/critical. Verified against real cases including
 * the exact boundary (score of 20) before implementation. No LLM
 * needed for the scoring itself.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

export interface RiskItem {
  name: string;
  likelihood: number;
  impact: number;
}

export interface ScoredRisk {
  name: string;
  score: number;
  band: RiskBand;
}

export function scoreRisk(item: RiskItem): ScoredRisk {
  const score = item.likelihood * item.impact;
  let band: RiskBand;
  if (score >= 20) band = 'critical';
  else if (score >= 12) band = 'high';
  else if (score >= 6) band = 'medium';
  else band = 'low';
  return { name: item.name, score, band };
}

export interface RiskRegister {
  scored: ScoredRisk[];
  criticalCount: number;
  highestScore: ScoredRisk | null;
}

export class RiskAnalystBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async assessRisks(items: RiskItem[]): Promise<RiskRegister> {
    await this.enforcePermission('read:risk-items');

    const scored = items.map(scoreRisk);
    const criticalCount = scored.filter((s) => s.band === 'critical').length;
    const highestScore = scored.reduce<ScoredRisk | null>(
      (max, s) => (max === null || s.score > max.score ? s : max),
      null,
    );

    const register: RiskRegister = { scored, criticalCount, highestScore };

    await this.createDecision({ itemCount: items.length }, { criticalCount }, 'risk-analyst-v1');

    if (criticalCount > 0) {
      await this.signalSwarm('employee.critical_risk_found', { botId: this.botId, criticalCount });
    }

    return register;
  }
}
