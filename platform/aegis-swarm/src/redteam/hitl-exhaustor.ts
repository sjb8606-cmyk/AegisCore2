/**
 * platform/aegis-swarm/src/redteam/hitl-exhaustor.ts
 *
 * R-17 — HITL Exhaustor.
 *
 * "Alert fatigue via high-volume noise." Different shape from the
 * earlier red-team bots: this doesn't trick one defense bot's
 * specific logic — it tests whether the SHARED infrastructure every
 * bot relies on (SwarmSignalBus, createDecision) has any built-in
 * rate-limiting or backpressure at all. Confirmed by direct grep
 * before this file was written: it does not, anywhere in
 * bot-runtime's crystal-bot.ts.
 *
 * attemptAlertFlood() fires a high volume of signals through the
 * real SwarmSignalBus class (via the isolated instance — same class,
 * same real publish()/subscribe() mechanics as the production
 * swarmSignalBus) and confirms every single one is delivered with
 * zero throttling, zero rejection, zero backpressure — even at high
 * volume. The real implication for production: since createDecision()
 * has the same lack of throttling, an attacker (or a buggy/compromised
 * legitimate bot) with normal write access could flood the real audit
 * trail and bot_decisions table with unlimited volume. Alert fatigue
 * doesn't require any single alert to be wrong — pure, unthrottled
 * volume is enough to degrade a human reviewer's ability to give each
 * one real scrutiny.
 */

import { RedTeamBot, redTeamSignalBus } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';

export interface FloodResult {
  technique: 'volume_flood';
  requestedCount: number;
  actualDeliveredCount: number;
  anyThrottled: boolean;
  attackSucceeded: boolean;
}

export class HitlExhaustorBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async attemptAlertFlood(floodCount: number): Promise<FloodResult> {
    await this.enforcePermission('redteam:attack-alert-volume');

    const received: unknown[] = [];
    const unsubscribe = redTeamSignalBus.subscribe((s) => received.push(s));

    for (let i = 0; i < floodCount; i++) {
      await this.signalSwarm('redteam.flood_signal', { index: i });
    }

    unsubscribe();

    const attemptResult: FloodResult = {
      technique: 'volume_flood',
      requestedCount: floodCount,
      actualDeliveredCount: received.length,
      anyThrottled: received.length < floodCount,
      attackSucceeded: received.length === floodCount,
    };

    await this.createDecision({ floodCount }, attemptResult, 'redteam-hitl-exhaustor-v1');
    await this.signalSwarm('redteam.alert_flood_attempt', { botId: this.botId, ...attemptResult });

    return attemptResult;
  }
}
