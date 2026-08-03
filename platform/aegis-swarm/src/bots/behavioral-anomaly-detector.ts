/**
 * platform/aegis-swarm/src/bots/behavioral-anomaly-detector.ts
 *
 * D-07 — Behavioral Anomaly Detector.
 *
 * The AppSpec describes this bot as "ML-based baseline deviation
 * detection." There is no ML/statistical training infrastructure of
 * any kind in this repo — no training pipeline, no model artifacts.
 * Rather than fake a model, this bot does the honest, real version of
 * the same underlying task with standard statistics: a z-score
 * (number of standard deviations from a known baseline's mean).
 * That's a legitimate, well-established anomaly-detection technique
 * in its own right — often literally the first-pass filter *inside*
 * ML-based systems — built here with real, verifiable math instead of
 * a model nobody can train or validate in this environment.
 *
 * LIVE CONTINUOUS MONITORING IS NOT AVAILABLE. @platform/observability
 * exposes only write-side OTel instruments (Counter/Histogram/
 * UpDownCounter, all .add()-only) — there is no query capability, and
 * no Prometheus/metrics-backend connection in this repo to pull real
 * historical values from. monitorLiveMetric() throws a clear, honest
 * error rather than faking a metrics-backend query. detectDeviation()
 * works today against any baseline of samples already in hand.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface Baseline {
  mean: number;
  stdDev: number;
  sampleCount: number;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  zScore: number;
  mean: number;
  stdDev: number;
  currentValue: number;
}

const MIN_BASELINE_SAMPLES = 2;
const DEFAULT_THRESHOLD_SIGMA = 3;

/**
 * Computes a real baseline (mean + sample standard deviation, with
 * Bessel's correction) from historical numeric observations. Exported
 * at module level — not just a private class method — so other bots
 * (e.g. D-15) can reuse this exact, verified math directly instead of
 * duplicating it.
 */
export function computeBaseline(samples: number[]): Baseline {
  if (samples.length < MIN_BASELINE_SAMPLES) {
    throw new Error(
      `Need at least ${MIN_BASELINE_SAMPLES} baseline samples to compute a meaningful standard ` +
        `deviation (got ${samples.length}).`,
    );
  }

  const n = samples.length;
  const mean = samples.reduce((sum, x) => sum + x, 0) / n;
  const variance = samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  return { mean, stdDev, sampleCount: n };
}

/**
 * Scores a value against a baseline via z-score. Handles the
 * zero-variance edge case explicitly rather than dividing by zero.
 * Exported for the same reuse reason as computeBaseline().
 */
export function scoreAgainstBaseline(
  baseline: Baseline,
  currentValue: number,
  thresholdSigma: number = DEFAULT_THRESHOLD_SIGMA,
): AnomalyResult {
  const { mean, stdDev } = baseline;

  if (stdDev === 0) {
    const isAnomaly = currentValue !== mean;
    return { isAnomaly, zScore: isAnomaly ? Infinity : 0, mean, stdDev, currentValue };
  }

  const zScore = (currentValue - mean) / stdDev;
  return { isAnomaly: Math.abs(zScore) > thresholdSigma, zScore, mean, stdDev, currentValue };
}

export class BehavioralAnomalyDetectorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async detectDeviation(
    metricName: string,
    baselineSamples: number[],
    currentValue: number,
    thresholdSigma: number = DEFAULT_THRESHOLD_SIGMA,
  ): Promise<AnomalyResult> {
    await this.enforcePermission('process:behavioral-metrics');

    const baseline = computeBaseline(baselineSamples);
    const result = scoreAgainstBaseline(baseline, currentValue, thresholdSigma);

    await this.createDecision(
      { metricName, sampleCount: baseline.sampleCount, currentValue, thresholdSigma },
      { isAnomaly: result.isAnomaly, zScore: result.zScore, mean: result.mean, stdDev: result.stdDev },
      'behavioral-anomaly-zscore-v1',
    );

    if (result.isAnomaly) {
      await this.signalSwarm('behavioral_anomaly.deviation_detected', {
        botId: this.botId,
        metricName,
        zScore: result.zScore,
        currentValue,
      });
    }

    return result;
  }

  async monitorLiveMetric(_metricName: string): Promise<never> {
    throw new Error(
      'Live continuous metric monitoring is not available yet: @platform/observability only ' +
        'exposes write-side OTel instruments (Counter/Histogram/UpDownCounter) with no query ' +
        'capability, and there is no Prometheus/metrics-backend connection in this repo to pull ' +
        'real historical values from. detectDeviation() works today against any baseline of ' +
        'samples already in hand.',
    );
  }
}
