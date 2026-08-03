/**
 * platform/aegis-swarm/src/bots/veridact-auditor.ts
 *
 * D-03 — Veridact Auditor.
 *
 * Validates Merkle chain integrity. Deliberately does NOT reimplement
 * chain verification — @platform/audit already has a complete, correct
 * verifyChain() (hash recomputation, prevHash linkage, sequence gap
 * detection). This bot wraps that real function, turns any break into
 * Findings, records a Decision, and signals the swarm.
 *
 * PRODUCTION FETCH IS NOT YET AVAILABLE. The AppSpec's role for this
 * bot is "continuous" verification against the real shipped chain —
 * but platform/audit/src/shipper.ts only writes events to S3 WORM and
 * tracks the current chain-tip hash (getChainHead()); there is no
 * function anywhere to list/fetch a tenant's shipped events back out
 * in sequence. fetchAndVerifyTenantChain() throws a clear, honest
 * error naming exactly that gap, rather than faking an S3 call I have
 * no credentials or mock to verify against.
 *
 * verifyChainIntegrity() itself works today against any ordered
 * ChainedEvent[] — e.g. a batch already fetched some other way.
 */

import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { verifyChain, ChainedEvent } from '@platform/audit';

export interface ChainIntegrityReport {
  findings: Finding[];
  valid: boolean;
  checked: number;
}

export class VeridactAuditorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  /**
   * Verifies an already-fetched, ordered array of chained audit
   * events. Real verification — every finding here reflects an actual
   * hash mismatch, prevHash break, or sequence gap that verifyChain()
   * detected, not a guess.
   */
  async verifyChainIntegrity(events: ChainedEvent[]): Promise<ChainIntegrityReport> {
    await this.enforcePermission('read:audit-chain');

    const result = verifyChain(events);
    const tenantId = events[0]?.tenantId ?? 'unknown';

    const findings: Finding[] = result.errors.map((errorMessage) => ({
      cat: 'sec',
      sev: 'block',
      loc: `audit-chain:${tenantId}`,
      desc: errorMessage,
      rec: 'Treat as a confirmed audit chain break — investigate immediately. A verified Merkle chain break means either tampering occurred or events were shipped out of order; both require human investigation before trusting anything downstream of the break.',
    }));

    const pi = this.computePI(findings);

    await this.createDecision(
      { tenantId, eventCount: events.length },
      { valid: result.valid, checked: result.checked, findingCount: findings.length, pi },
      'veridact-chain-verify-v1',
    );

    if (findings.length > 0) {
      await this.signalSwarm('veridact.chain_integrity_violation', {
        botId: this.botId,
        tenantId,
        count: findings.length,
      });
    }

    return { findings, valid: result.valid, checked: result.checked };
  }

  /**
   * Honest stub. There is no function in @platform/audit to list a
   * tenant's shipped WORM events back out in sequence — shipper.ts
   * only supports writing forward and reading the current chain-tip
   * hash. This throws rather than silently returning an empty/fake
   * result that could be mistaken for "nothing to verify."
   */
  async fetchAndVerifyTenantChain(_tenantId: string): Promise<never> {
    throw new Error(
      'Continuous chain verification is not available yet: @platform/audit has no function to ' +
        'list/fetch a tenant\'s shipped S3 WORM events back out in sequence (shipper.ts only writes ' +
        'forward and exposes getChainHead() for the current tip hash). verifyChainIntegrity() works ' +
        'today if you already have the ordered ChainedEvent[] from some other source.',
    );
  }
}
