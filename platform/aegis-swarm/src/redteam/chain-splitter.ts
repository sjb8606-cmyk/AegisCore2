/**
 * platform/aegis-swarm/src/redteam/chain-splitter.ts
 *
 * R-07 — Chain Splitter.
 *
 * "Veridact chain fork + gap injection." Same real target as R-02
 * (D-03's verifyChain()), genuinely different technique — attacks
 * sequence integrity and forking, not content/hash forgery.
 *
 * Two techniques, verified against the real algorithm before this
 * file was written:
 *
 * 1. attemptGapInjection() — removes an event from the middle of the
 *    chain, leaving a sequence gap. verifyChain() SHOULD catch this
 *    (detected: true is the expected, good outcome — defense working
 *    correctly, same positive-control shape as R-02's naive tamper).
 *
 * 2. attemptFork() — builds two independent, internally-consistent
 *    continuations from the same fork point in the chain (same shared
 *    prefix hash, different content afterward). BOTH branches
 *    independently report as fully valid via verifyChain() — this is
 *    the genuine finding: verifyChain() only ever examines one linear
 *    array at a time, so it has no way to detect that a competing,
 *    equally "valid" alternate history exists. Detecting a fork
 *    requires comparing multiple independently-submitted
 *    continuations against each other, or an externally-anchored
 *    single source of truth for the chain tip — neither exists in
 *    this repo. Not a D-03 bug; an inherent limitation this bot
 *    exists to surface, same spirit as R-02.
 */

import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';
import { linkEvent, verifyChain, ChainedEvent, AuditEvent } from '@platform/audit';

export interface GapInjectionResult {
  technique: 'gap_injection';
  removedIndex: number;
  gapDetected: boolean;
}

export interface ForkAttemptResult {
  technique: 'chain_fork';
  forkPointIndex: number;
  originalBranchValid: boolean;
  forkedBranchValid: boolean;
  branchesShareForkPointHash: boolean;
  branchTipsDiffer: boolean;
  forkSucceeded: boolean;
}

export class ChainSplitterBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async attemptGapInjection(chain: ChainedEvent[], removeIndex: number): Promise<GapInjectionResult> {
    await this.enforcePermission('redteam:attack-merkle-chain');

    const target = this.cloneTarget(chain);
    target.splice(removeIndex, 1);

    const result = verifyChain(target);

    const attemptResult: GapInjectionResult = {
      technique: 'gap_injection',
      removedIndex: removeIndex,
      gapDetected: !result.valid,
    };

    await this.createDecision({ removeIndex }, attemptResult, 'redteam-chain-splitter-gap-v1');
    await this.signalSwarm('redteam.chain_gap_attempt', { botId: this.botId, ...attemptResult });

    return attemptResult;
  }

  async attemptFork(
    chain: ChainedEvent[],
    forkPointIndex: number,
    forkedContent: Array<Partial<AuditEvent>>,
  ): Promise<ForkAttemptResult> {
    await this.enforcePermission('redteam:attack-merkle-chain');

    const original = this.cloneTarget(chain);
    const forkedBranch: ChainedEvent[] = original.slice(0, forkPointIndex + 1);

    let prevHash = forkedBranch[forkPointIndex]._hash;
    for (let i = 0; i < forkedContent.length; i++) {
      const sequence = forkPointIndex + 1 + i;
      const base: any = { ...original[sequence], ...forkedContent[i] };
      delete base._hash;
      delete base._prevHash;
      delete base._sequence;
      const linked = linkEvent(base, prevHash, sequence);
      forkedBranch.push(linked);
      prevHash = linked._hash;
    }

    const originalResult = verifyChain(original);
    const forkedResult = verifyChain(forkedBranch);

    const lastIndex = original.length - 1;
    const attemptResult: ForkAttemptResult = {
      technique: 'chain_fork',
      forkPointIndex,
      originalBranchValid: originalResult.valid,
      forkedBranchValid: forkedResult.valid,
      branchesShareForkPointHash: original[forkPointIndex]._hash === forkedBranch[forkPointIndex]._hash,
      branchTipsDiffer: original[lastIndex]?._hash !== forkedBranch[forkedBranch.length - 1]?._hash,
      forkSucceeded: originalResult.valid && forkedResult.valid,
    };

    await this.createDecision({ forkPointIndex }, attemptResult, 'redteam-chain-splitter-fork-v1');
    await this.signalSwarm('redteam.chain_fork_attempt', { botId: this.botId, ...attemptResult });

    return attemptResult;
  }
}
