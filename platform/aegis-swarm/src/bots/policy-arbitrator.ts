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

export class PolicyArbitratorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  /**
   * Records a human's actual verdict on a pending Synchronous Gate
   * decision. Refuses (rather than silently no-opping) if the
   * decision doesn't exist or isn't currently awaiting approval, so a
   * caller can never mistake "nothing happened" for "recorded."
   */
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

  /**
   * Surfaces prior human verdicts for the same rulesHash. Pure
   * decision-support context — never an automatic resolution.
   */
  async findPrecedent(rulesHash: string, limit = 20): Promise<PrecedentSummary> {
    await this.enforcePermission('read:decision-history');

    const precedents = await listDecisionsByRulesHash(rulesHash, limit);
    const approvedCount = precedents.filter((d) => d.status === 'approved').length;
    const rejectedCount = precedents.filter((d) => d.status === 'rejected').length;
    const hasConflict = approvedCount > 0 && rejectedCount > 0;

    const summary: PrecedentSummary = {
      rulesHash,
      hasPrecedent: precedents.length > 0,
      approvedCount,
      rejectedCount,
      hasConflict,
      mostRecentVerdict: (precedents[0]?.status as 'approved' | 'rejected' | undefined) ?? null,
      precedents,
    };

    await this.createDecision(
      { rulesHash },
      { hasPrecedent: summary.hasPrecedent, approvedCount, rejectedCount, hasConflict },
      'policy-arbitrator-precedent-v1',
    );

    if (hasConflict) {
      await this.signalSwarm('policy_arbitrator.precedent_conflict', {
        botId: this.botId,
        rulesHash,
        approvedCount,
        rejectedCount,
      });
    }

    return summary;
  }
}
