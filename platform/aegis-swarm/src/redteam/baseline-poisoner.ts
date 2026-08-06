/**
 * platform/aegis-swarm/src/redteam/baseline-poisoner.ts
 *
 * R-05 — Baseline Poisoner.
 *
 * Attacks D-07 (Behavioral Anomaly Detector) by poisoning the
 * baseline samples themselves, rather than the value being scored.
 * Reuses D-07's exact, real computeBaseline()/scoreAgainstBaseline()
 * functions — same discipline as R-02/D-15/D-18, never reimplements
 * the target's own math.
 *
 * Two techniques, both verified against the real functions before
 * this file was written:
 *
 * 1. attemptGradualDrift() — injects samples that gradually shift the
 *    baseline's mean upward over "time," so a value that would have
 *    been a massive statistical outlier under the clean baseline
 *    scores as unremarkable once the baseline has drifted to include
 *    it as normal.
 *
 * 2. attemptVarianceInflation() — mixes a handful of extreme values
 *    into the baseline (presented as legitimate "normal" observations)
 *    to inflate the standard deviation, which raises the absolute
 *    threshold for what counts as anomalous under the same sigma cutoff.
 *
 * Both are real, honest findings: z-score baseline deviation, as built
 * for D-07, has no built-in defense against a poisoned training set.
 * That's not a D-07 bug — every baseline-deviation approach needs a
 * separate mechanism (e.g. outlier-robust statistics, or validating
 * the provenance of what's allowed into the baseline) to resist this;
 * this bot exists to prove the gap is real, not theoretical.
 */

import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';
import { computeBaseline, scoreAgainstBaseline, Baseline } from '../bots/behavioral-anomaly-detector';

export interface PoisoningAttemptResult {
  technique: 'gradual_drift' | 'variance_inflation';
  originalBaseline: Baseline;
  poisonedBaseline: Baseline;
  testValue: number;
  detectedUnderOriginal: boolean;
  detectedUnderPoisoned: boolean;
  attackSucceeded: boolean;
}

export class BaselinePoisonerBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async attemptGradualDrift(
    cleanBaseline: number[],
    driftAmount: number,
    injectionCount: number,
    testValue: number,
    thresholdSigma?: number,
  ): Promise<PoisoningAttemptResult> {
    await this.enforcePermission('redteam:attack-behavioral-baseline');

    const clean = this.cloneTarget(cleanBaseline);
    const original = computeBaseline(clean);

    const poisonedSamples = this.cloneTarget(cleanBaseline);
    const baseValue = original.mean;
    for (let i = 0; i < injectionCount; i++) {
      poisonedSamples.push(baseValue + i * driftAmount);
    }
    const poisoned = computeBaseline(poisonedSamples);

    return this.recordAttempt('gradual_drift', original, poisoned, testValue, thresholdSigma);
  }

  async attemptVarianceInflation(
    cleanBaseline: number[],
    outlierValues: number[],
    testValue: number,
    thresholdSigma?: number,
  ): Promise<PoisoningAttemptResult> {
    await this.enforcePermission('redteam:attack-behavioral-baseline');

    const clean = this.cloneTarget(cleanBaseline);
    const original = computeBaseline(clean);

    const poisonedSamples = [...this.cloneTarget(cleanBaseline), ...this.cloneTarget(outlierValues)];
    const poisoned = computeBaseline(poisonedSamples);

    return this.recordAttempt('variance_inflation', original, poisoned, testValue, thresholdSigma);
  }

  private async recordAttempt(
    technique: 'gradual_drift' | 'variance_inflation',
    originalBaseline: Baseline,
    poisonedBaseline: Baseline,
    testValue: number,
    thresholdSigma?: number,
  ): Promise<PoisoningAttemptResult> {
    const beforeResult = scoreAgainstBaseline(originalBaseline, testValue, thresholdSigma);
    const afterResult = scoreAgainstBaseline(poisonedBaseline, testValue, thresholdSigma);

    const attemptResult: PoisoningAttemptResult = {
      technique,
      originalBaseline,
      poisonedBaseline,
      testValue,
      detectedUnderOriginal: beforeResult.isAnomaly,
      detectedUnderPoisoned: afterResult.isAnomaly,
      attackSucceeded: beforeResult.isAnomaly && !afterResult.isAnomaly,
    };

    await this.createDecision(
      { technique, testValue, thresholdSigma },
      attemptResult,
      'redteam-baseline-poisoner-v1',
    );

    await this.signalSwarm('redteam.baseline_poisoning_attempt', {
      botId: this.botId,
      ...attemptResult,
    });

    return attemptResult;
  }
}
