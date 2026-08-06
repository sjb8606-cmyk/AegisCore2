/**
 * platform/aegis-swarm/src/bots/sentinel-prime.ts
 *
 * D-01 — Sentinel Prime.
 *
 * Swarm orchestrator: cross-bot signal correlation. Unlike every other
 * bot built so far, Sentinel Prime does not scan files — it subscribes
 * to the shared swarmSignalBus and watches for multiple *distinct*
 * bots signaling something within the same short window. That pattern
 * (independent corroboration) is a stronger signal than any single
 * bot's finding alone, and is worth surfacing as its own incident.
 *
 * Design mirrors the Replicator's own "multi-source corroboration"
 * principle from the AppSpec: at least 2 independent bots must agree
 * within the window before this counts as a correlated incident.
 *
 * Detection/alerting only — never blocks or gates another bot's
 * action. Never touches the filesystem.
 */

import { CrystalBot, SwarmSignal, swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

const CORRELATION_WINDOW_MS = 60_000;
const MIN_DISTINCT_BOTS_FOR_INCIDENT = 2;

export interface CorrelatedIncident {
  types: string[];
  distinctBotIds: string[];
  signalCount: number;
  windowMs: number;
}

/**
 * Pure — filters signals to those within windowMs of `now`. Exported
 * at module level so other bots (e.g. R-11) can reuse this exact
 * logic directly instead of duplicating it. Same reasoning as D-07's
 * computeBaseline() and D-09's checkDrift() exports.
 */
export function pruneSignals(signals: SwarmSignal[], windowMs: number, now: number): SwarmSignal[] {
  return signals.filter((s) => now - new Date(s.timestamp).getTime() < windowMs);
}

/**
 * Pure — evaluates whether a set of (already-pruned) signals counts
 * as a correlated incident, given the cooldown state. No side
 * effects: does not create a Decision, does not signal anything, does
 * not mutate any state. The class method below is a thin wrapper that
 * adds those side effects on top of this pure evaluation.
 */
export function evaluateCorrelation(
  recentSignals: SwarmSignal[],
  windowMs: number,
  lastIncidentAt: number | null,
  now: number,
): CorrelatedIncident | null {
  const distinctBotIds = [...new Set(recentSignals.map((s) => s.fromBotId))];

  if (distinctBotIds.length < MIN_DISTINCT_BOTS_FOR_INCIDENT) return null;
  if (lastIncidentAt !== null && now - lastIncidentAt < windowMs) return null;

  return {
    types: [...new Set(recentSignals.map((s) => s.type))],
    distinctBotIds,
    signalCount: recentSignals.length,
    windowMs,
  };
}

export class SentinelPrimeBot extends CrystalBot {
  private recentSignals: SwarmSignal[] = [];
  private lastIncidentAt: number | null = null;

  constructor(spec: BotSpecification) {
    super(spec);
  }

  async activate(): Promise<() => void> {
    await this.enforcePermission('read:swarm-signals');

    return swarmSignalBus.subscribe((signal) => {
      this.ingest(signal).catch((err) => {
        this.logger.error({ err }, 'Sentinel Prime failed to process an incoming swarm signal');
      });
    });
  }

  async ingest(signal: SwarmSignal): Promise<CorrelatedIncident | null> {
    if (signal.fromBotId === this.botId) return null;

    this.recentSignals.push(signal);
    return this.checkCorrelation();
  }

  getRecentSignals(windowMs: number = CORRELATION_WINDOW_MS): SwarmSignal[] {
    this.recentSignals = pruneSignals(this.recentSignals, windowMs, Date.now());
    return this.recentSignals;
  }

  async checkCorrelation(windowMs: number = CORRELATION_WINDOW_MS): Promise<CorrelatedIncident | null> {
    const recent = this.getRecentSignals(windowMs);
    const now = Date.now();
    const incident = evaluateCorrelation(recent, windowMs, this.lastIncidentAt, now);

    if (!incident) return null;

    await this.createDecision(
      { windowMs },
      incident,
      'signal-correlation-v1',
    );

    await this.signalSwarm('sentinel.correlated_incident', incident);

    this.lastIncidentAt = now;
    return incident;
  }

  /** Test/operational convenience — clears in-memory state without touching any subscription. */
  reset(): void {
    this.recentSignals = [];
    this.lastIncidentAt = null;
  }
}
