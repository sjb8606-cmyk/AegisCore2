/**
 * platform/aegis-swarm/src/bots/policy-arbitrator.ts
 *
 * D-04 — Policy Arbitrator.
 *
 * "Resolves policy conflicts, maintains precedent catalog" — built on
 * a real gap this surfaced: nothing in this codebase previously
 * recorded a human's actual verdict on a Synchronous Gate decision
 * (status only ever moved to 'logged' or 'pending_approval', never
 * 'approved'/'rejected'). recordVerdict() fills that in, guarded so it
 * can only ever persist a verdict a human already made — it never
 * decides anything itself.
 *
 * findPrecedent() surfaces prior verdicts for the same rulesHash as
 * pure decision-support context for a human reviewing a new pending
 * decision. It never auto-applies a precedent. When the same rule has
 * been both approved AND rejected historically, that inconsistency
 * itself IS the "policy conflict" this bot exists to surface — a
 * signal that a human should resolve the underlying rule formally,
 * not keep deciding it ad hoc each time.
 */

import {
  CrystalBot,
  Decision,
  getDecision,
  updateDecisionStatus,
  listDecisionsByRulesHash,
} from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface VerdictRecord {
  decisionId: string;
  recorded: boolean;
  verdict: 'approved' | 'rejected';
}

export interface PrecedentSummary {
  rulesHash: string;
  hasPrecedent: boolean;
  approvedCount: number;
  rejectedCount: number;
  hasConflict: boolean;
  mostRecentVerdict: 'approved' | 'rejected' | null;
  precedents: Decision[];
}

/**
 * Pure — summarizes an already-fetched array of precedent Decisions.
 * Exported at module level so other code (e.g. R-16) can reuse this
 * exact logic directly against fabricated records without needing a
 * live database connection. Same reasoning as D-07/D-09/D-01/D-14's
 * exports.
 *
 * Has no way to distinguish a genuine human verdict from a fabricated
 * one — it only counts what's in the array it's given. That's the
 * real finding R-16 surfaces: nothing verifies who actually submitted
 * each verdict (recordVerdict's decidedBy parameter, same trust gap
 * as R-11's fromBotId).
 */
export function summarizePrecedents(rulesHash: string, precedents: Decision[]): PrecedentSummary {
  const approvedCount = precedents.filter((d) => d.status === 'approved').length;
  const rejectedCount = precedents.filter((d) => d.status === 'rejected').length;
  const hasConflict = approvedCount > 0 && rejectedCount > 0;

  return {
    rulesHash,
    hasPrecedent: precedents.length > 0,
    approvedCount,
    rejectedCount,
    hasConflict,
    mostRecentVerdict: (precedents[0]?.status as 'approved' | 'rejected' | undefined) ?? null,
    precedents,
  };
}

export class PolicyArbitratorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async recordVerdict(
    decisionId: string,
    verdict: 'approved' | 'rejected',
    decidedBy: string,
  ): Promise<VerdictRecord> {
    await this.enforcePermission('write:decision-verdicts');

    const existing = await getDecision(decisionId);
    if (!existing) {
      throw new Error(`No decision found with id "${decisionId}" — cannot record a verdict for it.`);
    }
    if (existing.status !== 'pending_approval') {
      throw new Error(
        `Decision "${decisionId}" is not awaiting approval (current status: "${existing.status}") — ` +
          'a verdict can only be recorded for a decision that is actually pending.',
      );
    }

    const recorded = await updateDecisionStatus(decisionId, verdict);

    await this.createDecision(
      { decisionId, verdict, decidedBy },
      { recorded },
      'policy-arbitrator-verdict-v1',
    );

    return { decisionId, recorded, verdict };
  }

  async findPrecedent(rulesHash: string, limit = 20): Promise<PrecedentSummary> {
    await this.enforcePermission('read:decision-history');

    const precedents = await listDecisionsByRulesHash(rulesHash, limit);
    const summary = summarizePrecedents(rulesHash, precedents);

    await this.createDecision(
      { rulesHash },
      {
        hasPrecedent: summary.hasPrecedent,
        approvedCount: summary.approvedCount,
        rejectedCount: summary.rejectedCount,
        hasConflict: summary.hasConflict,
      },
      'policy-arbitrator-precedent-v1',
    );

    if (summary.hasConflict) {
      await this.signalSwarm('policy_arbitrator.precedent_conflict', {
        botId: this.botId,
        rulesHash,
        approvedCount: summary.approvedCount,
        rejectedCount: summary.rejectedCount,
      });
    }

    return summary;
  }
}
