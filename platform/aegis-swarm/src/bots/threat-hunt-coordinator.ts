/**
 * platform/aegis-swarm/src/bots/threat-hunt-coordinator.ts
 *
 * D-21 — Threat Hunt Coordinator.
 *
 * "Proactive hypothesis-driven threat investigation" — distinct from
 * D-01 (Sentinel Prime), which passively correlates signals that have
 * already fired. This bot is proactive: given a hypothesis about what
 * might be happening, it identifies which of this swarm's real,
 * already-built bots are relevant to confirming or refuting it, then
 * tracks the investigation to a real conclusion.
 *
 * The hypothesis library only references bot IDs that are genuinely
 * built and real tonight — never a skipped/blocked bot (D-08, D-10)
 * or one only "fulfilled by existing infrastructure" (D-11).
 *
 * In-memory tracking, same pattern as D-01 — a threat hunt is an
 * active working session, not data that needs to survive a process
 * restart the way a purge request or incident record does.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type HypothesisStatus = 'open' | 'confirmed' | 'refuted' | 'inconclusive';

export interface Hypothesis {
  id: string;
  category: string;
  statement: string;
  relevantBotIds: string[];
  status: HypothesisStatus;
  evidence: Array<{ botId: string; findingCount: number; notedAt: string }>;
  createdAt: string;
}

const HYPOTHESIS_LIBRARY: Record<string, string[]> = {
  active_exfiltration: ['D-15', 'D-18'],
  supply_chain_compromise: ['D-02', 'D-06', 'D-19'],
  insider_credential_misuse: ['D-16', 'D-25', 'D-26'],
  audit_tampering: ['D-03'],
};

const ALLOWED_RESOLUTIONS: HypothesisStatus[] = ['confirmed', 'refuted', 'inconclusive'];

export class ThreatHuntCoordinatorBot extends CrystalBot {
  private hypotheses = new Map<string, Hypothesis>();
  private nextId = 1;

  constructor(spec: BotSpecification) {
    super(spec);
  }

  async openHypothesis(category: string, statement: string): Promise<Hypothesis | null> {
    await this.enforcePermission('write:threat-hunts');

    const relevantBotIds = HYPOTHESIS_LIBRARY[category];
    if (!relevantBotIds) return null;

    const hypothesis: Hypothesis = {
      id: `hunt-${this.nextId++}`,
      category,
      statement,
      relevantBotIds,
      status: 'open',
      evidence: [],
      createdAt: new Date().toISOString(),
    };

    this.hypotheses.set(hypothesis.id, hypothesis);

    await this.createDecision(
      { category, statement },
      { hypothesisId: hypothesis.id, relevantBotIds },
      'threat-hunt-open-v1',
    );

    await this.signalSwarm('threat_hunt.hypothesis_opened', {
      botId: this.botId,
      hypothesisId: hypothesis.id,
      category,
      relevantBotIds,
    });

    return hypothesis;
  }

  async recordEvidence(hypothesisId: string, botId: string, findingCount: number): Promise<boolean> {
    await this.enforcePermission('write:threat-hunts');

    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis || hypothesis.status !== 'open') return false;

    hypothesis.evidence.push({ botId, findingCount, notedAt: new Date().toISOString() });
    return true;
  }

  async resolveHypothesis(hypothesisId: string, resolution: HypothesisStatus): Promise<boolean> {
    await this.enforcePermission('write:threat-hunts');

    if (!ALLOWED_RESOLUTIONS.includes(resolution)) return false;

    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis || hypothesis.status !== 'open') return false;

    hypothesis.status = resolution;

    await this.createDecision(
      { hypothesisId, resolution },
      { evidenceCount: hypothesis.evidence.length },
      'threat-hunt-resolve-v1',
    );

    if (resolution === 'confirmed') {
      await this.signalSwarm('threat_hunt.hypothesis_confirmed', {
        botId: this.botId,
        hypothesisId,
        category: hypothesis.category,
      });
    }

    return true;
  }

  async getHypothesis(hypothesisId: string): Promise<Hypothesis | null> {
    await this.enforcePermission('read:threat-hunts');
    return this.hypotheses.get(hypothesisId) ?? null;
  }
}
