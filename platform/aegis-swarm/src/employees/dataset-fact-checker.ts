/**
 * platform/aegis-swarm/src/employees/dataset-fact-checker.ts
 *
 * E-31 — Dataset Fact-Checker.
 *
 * From the person's own spec. The real isolation rule — "the Fact-
 * Checker never sees the Harvester's confidence level, reasoning, or
 * conclusions, only the raw schema output" — is enforced structurally,
 * not just by policy: FactCheckInput only accepts claimId, category,
 * claimedValue, and claimedSource. There is no confidence or
 * reasoning field to leak, because HarvestedClaim (E-30) never had
 * one in the first place. Same isolation principle as RedTeamBot's
 * separate signal bus earlier tonight, applied here to prevent
 * sycophantic rubber-stamping instead of production contamination.
 *
 * escalateForSafety() is the other real rule from the spec: a 🟡
 * (plausible/unconfirmed) finding on a safety-critical claim always
 * escalates to 🔴 (disputed) — verified against both cases, plus the
 * case that a genuinely 🟢 (verified) finding stays verified even
 * when safety-critical, before implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type ConfidenceTag = 'verified' | 'plausible_unconfirmed' | 'disputed';

export interface FactCheckInput {
  claimId: string;
  category: string;
  claimedValue: string | null;
  claimedSource: string;
  independentSourceChecked: string;
  safetyCritical: boolean;
}

export interface FactCheckResult {
  claimId: string;
  tag: ConfidenceTag;
  requiresHumanReview: boolean;
}

export function escalateForSafety(tag: ConfidenceTag, safetyCritical: boolean): ConfidenceTag {
  if (safetyCritical && tag === 'plausible_unconfirmed') return 'disputed';
  return tag;
}

export class DatasetFactCheckerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async checkClaim(input: FactCheckInput, rawTag: ConfidenceTag): Promise<FactCheckResult> {
    await this.enforcePermission('write:fact-check-results');

    const tag = escalateForSafety(rawTag, input.safetyCritical);
    const requiresHumanReview = tag !== 'verified';

    const result: FactCheckResult = { claimId: input.claimId, tag, requiresHumanReview };

    await this.createDecision({ claimId: input.claimId, safetyCritical: input.safetyCritical }, { tag }, 'dataset-fact-checker-v1');

    if (requiresHumanReview) {
      await this.signalSwarm('employee.fact_check_needs_review', { botId: this.botId, claimId: input.claimId, tag });
    }

    return result;
  }
}
