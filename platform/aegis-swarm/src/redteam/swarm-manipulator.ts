/**
 * platform/aegis-swarm/src/redteam/swarm-manipulator.ts
 *
 * R-11 — Swarm Manipulator.
 *
 * "D-01 false signal injection." Reuses D-01's exact, real
 * pruneSignals()/evaluateCorrelation() functions (refactored to
 * standalone exports for this purpose, same pattern as D-07/D-09)
 * rather than instantiating a real SentinelPrimeBot, which would
 * write real decisions/signals into production the moment
 * checkCorrelation() ran.
 *
 * The technique, verified against the real functions before this file
 * was written: a single fabricated source can manufacture multiple
 * SwarmSignal objects, each CLAIMING a different fromBotId. Nothing
 * in evaluateCorrelation() (or anywhere else in this codebase)
 * authenticates that a signal genuinely originated from the bot named
 * in fromBotId — it's trusted completely at face value. This lets one
 * attacker manufacture a fully "correlated incident" that looks like
 * genuine independent multi-bot corroboration, when it never happened.
 *
 * A control case is included and tested: a single real bot signaling
 * repeatedly does NOT trigger correlation (the distinctBotIds check
 * itself works correctly) — the gap is specifically that the claimed
 * identity behind each signal is never verified.
 */

import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';
import { SwarmSignal } from '@platform/bot-runtime';
import { pruneSignals, evaluateCorrelation, CorrelatedIncident } from '../bots/sentinel-prime';

export interface SpoofInjectionResult {
  technique: 'spoofed_multi_bot_injection';
  claimedBotIds: string[];
  manufacturedIncident: CorrelatedIncident | null;
  attackSucceeded: boolean;
}

export class SwarmManipulatorBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async attemptSpoofedInjection(
    claimedBotIds: string[],
    signalType: string,
    windowMs: number = 60_000,
  ): Promise<SpoofInjectionResult> {
    await this.enforcePermission('redteam:attack-swarm-correlation');

    const now = Date.now();
    const fabricatedSignals: SwarmSignal[] = claimedBotIds.map((botId, i) => ({
      type: signalType,
      fromBotId: botId,
      payload: { fabricated: true },
      timestamp: new Date(now + i * 100).toISOString(),
    }));

    const pruned = pruneSignals(fabricatedSignals, windowMs, now + claimedBotIds.length * 100);
    const manufacturedIncident = evaluateCorrelation(pruned, windowMs, null, now + claimedBotIds.length * 100);

    const attemptResult: SpoofInjectionResult = {
      technique: 'spoofed_multi_bot_injection',
      claimedBotIds,
      manufacturedIncident,
      attackSucceeded: manufacturedIncident !== null,
    };

    await this.createDecision({ claimedBotIds, signalType }, attemptResult, 'redteam-swarm-manipulator-v1');
    await this.signalSwarm('redteam.swarm_manipulation_attempt', { botId: this.botId, ...attemptResult });

    return attemptResult;
  }

  async attemptSingleBotRepeat(
    botId: string,
    repeatCount: number,
    windowMs: number = 60_000,
  ): Promise<{ triggeredFalsely: boolean }> {
    await this.enforcePermission('redteam:attack-swarm-correlation');

    const now = Date.now();
    const signals: SwarmSignal[] = Array.from({ length: repeatCount }, (_, i) => ({
      type: `signal-${i}`,
      fromBotId: botId,
      payload: {},
      timestamp: new Date(now + i * 100).toISOString(),
    }));

    const pruned = pruneSignals(signals, windowMs, now + repeatCount * 100);
    const incident = evaluateCorrelation(pruned, windowMs, null, now + repeatCount * 100);

    return { triggeredFalsely: incident !== null };
  }
}
