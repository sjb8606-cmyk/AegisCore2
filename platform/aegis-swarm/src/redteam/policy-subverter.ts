/**
 * platform/aegis-swarm/src/redteam/policy-subverter.ts
 *
 * R-16 — Policy Subverter.
 *
 * "D-04 precedent poisoning." Reuses D-04's exact, real
 * summarizePrecedents() function (refactored to a standalone export
 * for this purpose, same pattern as D-07/D-09/D-01/D-14) rather than
 * instantiating a real PolicyArbitratorBot, whose findPrecedent()
 * would hit a real Postgres connection this sandbox doesn't have and
 * would write real decisions/signals into production.
 *
 * The real, verified finding: recordVerdict()'s `decidedBy` parameter
 * is a plain string, never checked against any authentication or
 * authorization system — exactly the same trust gap as R-11's
 * fromBotId spoofing on D-01, just showing up on D-04's precedent
 * catalog instead. A single attacker can fabricate multiple "approved"
 * verdicts, each CLAIMING a different decidedBy identity, and
 * summarizePrecedents() reports them as genuine independent consensus
 * (approvedCount rising, hasConflict staying false) with no way to
 * tell they all came from one source.
 *
 * A control case confirms the counting logic itself is sound: mixing
 * in even one genuine dissenting record correctly flips hasConflict
 * to true. The gap is specifically the missing identity verification
 * on each verdict, not the summarization arithmetic.
 */

import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';
import { Decision } from '@platform/bot-runtime';
import { summarizePrecedents, PrecedentSummary } from '../bots/policy-arbitrator';

export interface PoisonPrecedentResult {
  technique: 'fabricated_multi_identity_approval';
  rulesHash: string;
  claimedIdentities: string[];
  manufacturedSummary: PrecedentSummary;
  attackSucceeded: boolean;
}

export class PolicySubverterBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async attemptPrecedentPoisoning(
    rulesHash: string,
    claimedIdentities: string[],
  ): Promise<PoisonPrecedentResult> {
    await this.enforcePermission('redteam:attack-precedent-catalog');

    const fabricated: Decision[] = claimedIdentities.map((identity, i) => ({
      id: `fabricated-${i}`,
      botId: 'D-17',
      status: 'approved',
      input: { decidedBy: identity },
      output: {},
      rulesHash,
      timestamp: new Date().toISOString(),
    }));

    const manufacturedSummary = summarizePrecedents(rulesHash, fabricated);

    const attemptResult: PoisonPrecedentResult = {
      technique: 'fabricated_multi_identity_approval',
      rulesHash,
      claimedIdentities,
      manufacturedSummary,
      attackSucceeded:
        manufacturedSummary.approvedCount === claimedIdentities.length && !manufacturedSummary.hasConflict,
    };

    await this.createDecision({ rulesHash, claimedIdentities }, attemptResult, 'redteam-policy-subverter-v1');
    await this.signalSwarm('redteam.precedent_poisoning_attempt', { botId: this.botId, ...attemptResult });

    return attemptResult;
  }

  async attemptWithDissent(
    rulesHash: string,
    claimedIdentities: string[],
  ): Promise<{ hasConflict: boolean }> {
    await this.enforcePermission('redteam:attack-precedent-catalog');

    const fabricatedApprovals: Decision[] = claimedIdentities.map((identity, i) => ({
      id: `fabricated-${i}`,
      botId: 'D-17',
      status: 'approved',
      input: { decidedBy: identity },
      output: {},
      rulesHash,
      timestamp: new Date().toISOString(),
    }));

    const genuineDissent: Decision = {
      id: 'genuine-dissent',
      botId: 'D-17',
      status: 'rejected',
      input: {},
      output: {},
      rulesHash,
      timestamp: new Date().toISOString(),
    };

    const summary = summarizePrecedents(rulesHash, [...fabricatedApprovals, genuineDissent]);
    return { hasConflict: summary.hasConflict };
  }
}
