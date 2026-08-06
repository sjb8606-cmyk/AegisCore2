/**
 * platform/aegis-swarm/src/redteam/timestamp-manipulator.ts
 *
 * R-08 — Timestamp Manipulator.
 *
 * "D-09 drift threshold probing." Reuses D-09's exact, real
 * checkDrift() function (refactored to a standalone export for this
 * exact reason, same pattern as D-07) rather than reimplementing or
 * — critically — instantiating a real TimeKeeperBot and calling its
 * public method, which would have written real decisions/signals
 * into production despite this being a red-team exercise. Pure
 * function reuse avoids that entirely.
 *
 * Two techniques, both verified against the real function before this
 * file was written:
 *
 * 1. attemptBoundaryProbe() — confirms drift exactly equal to the
 *    threshold evades detection, since checkDrift() uses strict `>`,
 *    not `>=`. Real, exploitable if an attacker can precisely control
 *    drift to land exactly at the boundary.
 *
 * 2. attemptThresholdInflation() — confirms that driftThresholdMs is
 *    a plain function parameter, not a protected internal constant.
 *    A massive, wildly anomalous drift (500 seconds, verified) evades
 *    detection completely if the threshold value itself can be
 *    influenced by whatever calls checkDrift(). This isn't a D-09
 *    bug — it's a caller-responsibility gap worth surfacing: any
 *    integration that lets external input reach the threshold
 *    parameter defeats detection entirely, regardless of actual drift.
 */

import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';
import { checkDrift } from '../bots/time-keeper';

export interface BoundaryProbeResult {
  technique: 'boundary_probe';
  driftMs: number;
  driftThresholdMs: number;
  detectedAtBoundary: boolean;
  detectedJustOver: boolean;
  boundaryEvasionConfirmed: boolean;
}

export interface ThresholdInflationResult {
  technique: 'threshold_inflation';
  actualDriftMs: number;
  normalThresholdMs: number;
  inflatedThresholdMs: number;
  detectedUnderNormalThreshold: boolean;
  detectedUnderInflatedThreshold: boolean;
  attackSucceeded: boolean;
}

export class TimestampManipulatorBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async attemptBoundaryProbe(
    localTimeMs: number,
    driftThresholdMs: number,
  ): Promise<BoundaryProbeResult> {
    await this.enforcePermission('redteam:attack-time-verification');

    const atBoundary = checkDrift(localTimeMs, localTimeMs + driftThresholdMs, driftThresholdMs);
    const justOver = checkDrift(localTimeMs, localTimeMs + driftThresholdMs + 1, driftThresholdMs);

    const attemptResult: BoundaryProbeResult = {
      technique: 'boundary_probe',
      driftMs: driftThresholdMs,
      driftThresholdMs,
      detectedAtBoundary: atBoundary.recommendFortressMode,
      detectedJustOver: justOver.recommendFortressMode,
      boundaryEvasionConfirmed: !atBoundary.recommendFortressMode && justOver.recommendFortressMode,
    };

    await this.createDecision({ driftThresholdMs }, attemptResult, 'redteam-timestamp-manipulator-boundary-v1');
    await this.signalSwarm('redteam.timestamp_boundary_probe', { botId: this.botId, ...attemptResult });

    return attemptResult;
  }

  async attemptThresholdInflation(
    localTimeMs: number,
    actualDriftMs: number,
    normalThresholdMs: number,
    inflatedThresholdMs: number,
  ): Promise<ThresholdInflationResult> {
    await this.enforcePermission('redteam:attack-time-verification');

    const externalTimeMs = localTimeMs + actualDriftMs;
    const underNormal = checkDrift(localTimeMs, externalTimeMs, normalThresholdMs);
    const underInflated = checkDrift(localTimeMs, externalTimeMs, inflatedThresholdMs);

    const attemptResult: ThresholdInflationResult = {
      technique: 'threshold_inflation',
      actualDriftMs,
      normalThresholdMs,
      inflatedThresholdMs,
      detectedUnderNormalThreshold: underNormal.recommendFortressMode,
      detectedUnderInflatedThreshold: underInflated.recommendFortressMode,
      attackSucceeded: underNormal.recommendFortressMode && !underInflated.recommendFortressMode,
    };

    await this.createDecision(
      { actualDriftMs, normalThresholdMs, inflatedThresholdMs },
      attemptResult,
      'redteam-timestamp-manipulator-inflation-v1',
    );
    await this.signalSwarm('redteam.threshold_inflation_attempt', { botId: this.botId, ...attemptResult });

    return attemptResult;
  }
}
