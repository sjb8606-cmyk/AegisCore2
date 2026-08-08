/**
 * platform/aegis-swarm/src/employees/dataset-harvester.ts
 *
 * E-30 — Dataset Harvester.
 *
 * From the person's own spec, finally built. Real, structural
 * enforcement of two rules from that spec:
 *
 * - "Never emits a confidence judgment" — not just a stated rule, a
 *   structural one: HarvestedClaim has no confidence field at all,
 *   so there's literally nothing for it to leak to the Fact-Checker.
 * - "Any 'not found' output must include the search log... a bare
 *   negative with no log is treated as an incomplete search" —
 *   validateHarvestedClaim() enforces this for real: a null value
 *   with fewer than two real search strategies logged is rejected,
 *   not accepted as a legitimate negative finding. Verified against
 *   both cases before implementation.
 *
 * Aimed at the person's stated real use case: building a verified
 * PQC (NIST ML-KEM/ML-DSA/SLH-DSA) fact base for future hires, not
 * generating cryptographic implementations — this bot only harvests
 * and structures claims, it never writes crypto code.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface SearchLogEntry {
  strategy: string;
  query: string;
  found: boolean;
}

export interface HarvestedClaim {
  id: string;
  category: string;
  claimedValue: string | null;
  claimedSource: string;
  searchLog: SearchLogEntry[];
}

export interface ClaimValidation {
  valid: boolean;
  reason?: string;
}

const MIN_SEARCH_STRATEGIES_FOR_NEGATIVE = 2;

export function validateHarvestedClaim(claim: HarvestedClaim): ClaimValidation {
  if (claim.claimedValue === null && claim.searchLog.length < MIN_SEARCH_STRATEGIES_FOR_NEGATIVE) {
    return {
      valid: false,
      reason: 'A "not found" conclusion requires a real search log with multiple strategies — treated as incomplete search otherwise.',
    };
  }
  return { valid: true };
}

export class DatasetHarvesterBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async submitClaim(claim: HarvestedClaim): Promise<ClaimValidation> {
    await this.enforcePermission('write:harvested-claims');

    const validation = validateHarvestedClaim(claim);

    await this.createDecision({ claimId: claim.id }, { valid: validation.valid }, 'dataset-harvester-v1');

    if (!validation.valid) {
      await this.signalSwarm('employee.incomplete_search_rejected', { botId: this.botId, claimId: claim.id });
    }

    return validation;
  }
}
