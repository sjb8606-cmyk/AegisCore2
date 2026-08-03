/**
 * platform/aegis-swarm/src/bots/time-keeper.ts
 *
 * D-09 — Time-Keeper.
 *
 * Dual-source time verification: compares local system time against
 * an external time source, and recommends Fortress Mode (default-deny
 * lockdown posture) if the drift exceeds a threshold OR the external
 * source was unreachable at all — an unreachable external source is
 * treated as seriously as detected drift, per the AppSpec's
 * default-deny principle.
 *
 * DELIBERATELY DOES NOT flip a global process.env.FORTRESS_MODE
 * switch itself. Nothing in this repo currently reads that switch —
 * setting it would be a fake "it works" gesture, not real behavior.
 * This bot's job is to detect and recommend; actually enacting a
 * system-wide lockdown is separate wiring for whoever builds that
 * mechanism, matching the Constitution's "detect, analyze, alert,
 * advise" — not "act on production systems without human approval."
 *
 * hitlClassification is Synchronous Gate: a genuine temporal
 * integrity failure is serious enough to require an explicit human
 * verdict (recorded via D-04's recordVerdict()) before anything that
 * depends on trusted time proceeds.
 *
 * LIVE EXTERNAL TIME FETCHING IS NOT AVAILABLE. This sandbox has no
 * network access, so an actual HTTPS call to an external time source
 * (Cloudflare, Google, etc.) cannot be verified here — fetchExternalTime()
 * throws a clear, honest error rather than shipping a network call
 * nobody has confirmed actually works. verifyTemporalIntegrity() works
 * today against any two timestamps already in hand.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface TemporalIntegrityResult {
  recommendFortressMode: boolean;
  reason: 'drift exceeds threshold' | 'external time source unreachable' | null;
  driftMs: number | null;
  decisionId: string;
}

/** Internal — the assessment itself, before a Decision (and its id) exists yet. */
interface DriftAssessment {
  recommendFortressMode: boolean;
  reason: 'drift exceeds threshold' | 'external time source unreachable' | null;
  driftMs: number | null;
}

const DEFAULT_DRIFT_THRESHOLD_MS = 500;

export class TimeKeeperBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async verifyTemporalIntegrity(
    localTimeMs: number,
    externalTimeMs: number | null,
    driftThresholdMs: number = DEFAULT_DRIFT_THRESHOLD_MS,
  ): Promise<TemporalIntegrityResult> {
    await this.enforcePermission('read:system-clock');

    const result = this.computeIntegrity(localTimeMs, externalTimeMs, driftThresholdMs);

    const decision = await this.createDecision(
      { localTimeMs, externalTimeMs, driftThresholdMs },
      result,
      'time-keeper-drift-v1',
    );

    if (result.recommendFortressMode) {
      await this.signalSwarm('time_keeper.fortress_mode_recommended', {
        botId: this.botId,
        reason: result.reason,
        driftMs: result.driftMs,
      });
    }

    return { ...result, decisionId: decision.id };
  }

  async fetchExternalTime(): Promise<never> {
    throw new Error(
      'Live external time fetching is not available yet: this environment has no network access ' +
        'to verify a real HTTPS call to an external time source (Cloudflare, Google Time, etc.). ' +
        'verifyTemporalIntegrity() works today if you already have both timestamps in hand — e.g. ' +
        'obtained via curl or a scheduled job with real network access.',
    );
  }

  private computeIntegrity(
    localTimeMs: number,
    externalTimeMs: number | null,
    driftThresholdMs: number,
  ): DriftAssessment {
    if (externalTimeMs === null) {
      return { recommendFortressMode: true, reason: 'external time source unreachable', driftMs: null };
    }

    const driftMs = Math.abs(localTimeMs - externalTimeMs);
    const recommendFortressMode = driftMs > driftThresholdMs;

    return {
      recommendFortressMode,
      reason: recommendFortressMode ? 'drift exceeds threshold' : null,
      driftMs,
    };
  }
}
