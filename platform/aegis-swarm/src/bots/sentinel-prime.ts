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

export class SentinelPrimeBot extends CrystalBot {
  private recentSignals: SwarmSignal[] = [];
  private lastIncidentAt: number | null = null;

  constructor(spec: BotSpecification) {
    super(spec);
  }

  /**
   * Subscribes to the swarm signal bus. Returns an unsubscribe
   * function — callers (and tests) are responsible for calling it
   * when done, same as any other swarmSignalBus.subscribe() caller.
   */
  async activate(): Promise<() => void> {
    await this.enforcePermission('read:swarm-signals');

    return swarmSignalBus.subscribe((signal) => {
      this.ingest(signal).catch((err) => {
        this.logger.error({ err }, 'Sentinel Prime failed to process an incoming swarm signal');
      });
    });
  }

  /**
   * Handles one incoming signal: ignores Sentinel Prime's own signals
   * (to prevent it correlating against itself), records the signal,
   * and immediately re-evaluates for a correlated incident.
   */
  async ingest(signal: SwarmSignal): Promise<CorrelatedIncident | null> {
    if (signal.fromBotId === this.botId) return null;

    this.recentSignals.push(signal);
    return this.checkCorrelation();
  }

  /**
   * Returns signals currently within the correlation window, pruning
   * anything older first. Always prunes on its own — safe to call
   * directly (e.g. from a test or a scheduled health check) without
   * requiring a fresh ingest() call first.
   */
  getRecentSignals(windowMs: number = CORRELATION_WINDOW_MS): SwarmSignal[] {
    const now = Date.now();
    this.recentSignals = this.recentSignals.filter(
      (s) => now - new Date(s.timestamp).getTime() < windowMs,
    );
    return this.recentSignals;
  }

  /**
   * Evaluates whether enough distinct bots have signaled within the
   * window to count as a correlated incident. Fires at most once per
   * window (cooldown) so a burst of corroborating signals doesn't
   * spam a fresh incident alert for every single one of them.
   */
  async checkCorrelation(windowMs: number = CORRELATION_WINDOW_MS): Promise<CorrelatedIncident | null> {
    const recent = this.getRecentSignals(windowMs);
    const distinctBotIds = [...new Set(recent.map((s) => s.fromBotId))];

    if (distinctBotIds.length < MIN_DISTINCT_BOTS_FOR_INCIDENT) return null;

    const now = Date.now();
    if (this.lastIncidentAt !== null && now - this.lastIncidentAt < windowMs) return null;

    const incident: CorrelatedIncident = {
      types: [...new Set(recent.map((s) => s.type))],
      distinctBotIds,
      signalCount: recent.length,
      windowMs,
    };

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
