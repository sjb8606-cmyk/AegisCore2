/**
 * platform/aegis-swarm/src/redteam/merkle-mangler.ts
 *
 * R-02 — Merkle Mangler.
 *
 * The AppSpec describes this as "SLH-DSA collision/forgery attempts."
 * SLH-DSA doesn't exist in this repo (@platform/pqcrypto, Phase 1,
 * never built) — so this bot attacks what's actually real instead:
 * the SHA-256 hash-chain mechanism in @platform/audit/src/merkle.ts,
 * the exact thing D-03 (Veridact Auditor) verifies. It reuses the
 * real hashEvent()/linkEvent()/verifyChain() functions directly,
 * rather than reimplementing chain logic — same discipline as every
 * defense bot tonight.
 *
 * Two techniques, verified against the real algorithm before this
 * file was written (not assumed):
 *
 * 1. attemptNaiveTamper() — change one event's content without
 *    recomputing anything downstream. verifyChain() SHOULD catch this
 *    (forgeryDetected: true is the expected, good outcome — defense
 *    working correctly).
 *
 * 2. attemptConsistentReforge() — change one event's content AND
 *    correctly re-link every subsequent event using the same real
 *    functions an honest chain-builder would use. verifyChain()
 *    reports this as fully VALID (forgeryDetected: false) — this is
 *    the genuine, important finding: pure hash-chain self-consistency
 *    is not tamper-evident against an attacker with full write access
 *    and no externally-anchored chain tip. That's not a bug in D-03 —
 *    it's an inherent limitation this bot exists to surface.
 */

import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';
import { linkEvent, verifyChain, GENESIS_HASH, ChainedEvent, AuditEvent } from '@platform/audit';

export interface ForgeryAttemptResult {
  technique: 'naive_tamper' | 'consistent_reforge';
  tamperIndex: number;
  chainReportedValid: boolean;
  forgeryDetected: boolean;
}

export class MerkleManglerBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async attemptNaiveTamper(
    chain: ChainedEvent[],
    tamperIndex: number,
    contentOverride: Partial<AuditEvent>,
  ): Promise<ForgeryAttemptResult> {
    await this.enforcePermission('redteam:attack-merkle-chain');

    const target = this.cloneTarget(chain);
    target[tamperIndex] = { ...target[tamperIndex], ...contentOverride };

    const result = verifyChain(target);
    return this.recordAttempt('naive_tamper', tamperIndex, result.valid);
  }

  async attemptConsistentReforge(
    chain: ChainedEvent[],
    tamperIndex: number,
    contentOverride: Partial<AuditEvent>,
  ): Promise<ForgeryAttemptResult> {
    await this.enforcePermission('redteam:attack-merkle-chain');

    const target = this.cloneTarget(chain);

    const tamperedBase: any = { ...target[tamperIndex], ...contentOverride };
    delete tamperedBase._hash;
    delete tamperedBase._prevHash;
    delete tamperedBase._sequence;

    const newPrevHash = tamperIndex === 0 ? GENESIS_HASH : target[tamperIndex - 1]._hash;
    target[tamperIndex] = linkEvent(tamperedBase, newPrevHash, tamperIndex);

    for (let i = tamperIndex + 1; i < target.length; i++) {
      const base: any = { ...target[i] };
      delete base._hash;
      delete base._prevHash;
      delete base._sequence;
      target[i] = linkEvent(base, target[i - 1]._hash, i);
    }

    const result = verifyChain(target);
    return this.recordAttempt('consistent_reforge', tamperIndex, result.valid);
  }

  private async recordAttempt(
    technique: 'naive_tamper' | 'consistent_reforge',
    tamperIndex: number,
    chainReportedValid: boolean,
  ): Promise<ForgeryAttemptResult> {
    const attemptResult: ForgeryAttemptResult = {
      technique,
      tamperIndex,
      chainReportedValid,
      forgeryDetected: !chainReportedValid,
    };

    await this.createDecision({ technique, tamperIndex }, attemptResult, 'redteam-merkle-mangler-v1');

    await this.signalSwarm('redteam.merkle_forgery_attempt', {
      botId: this.botId,
      ...attemptResult,
    });

    return attemptResult;
  }
}
