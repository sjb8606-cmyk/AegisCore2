/**
 * platform/aegis-swarm/src/employees/mori.ts
 *
 * E-17 — Mori.
 *
 * Built deliberately narrow and careful, given this touches personal
 * wellbeing. This bot does exactly one thing: real elapsed-time
 * arithmetic on work sessions the person explicitly logs themselves.
 * It reports real numbers — total hours, longest session, count of
 * sessions over a threshold — and nothing else.
 *
 * What this bot deliberately does NOT do:
 * - No diagnostic claims, no "you seem burned out," no interpretation
 *   of what the numbers mean.
 * - No automatic monitoring — sessions are only ever explicitly
 *   logged by the person, never inferred or tracked passively.
 * - No mental-health framing of any kind. Purely factual reporting,
 *   same as a stopwatch. What the numbers mean is entirely the
 *   person's own call.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface WorkSession {
  startMs: number;
  endMs: number;
}

const MS_PER_HOUR = 3600000;

export function computeWeeklyTotal(sessions: WorkSession[], windowStartMs: number, windowEndMs: number): number {
  return sessions
    .filter((s) => s.startMs >= windowStartMs && s.startMs < windowEndMs)
    .reduce((sum, s) => sum + (s.endMs - s.startMs) / MS_PER_HOUR, 0);
}

export function computeLongestSession(sessions: WorkSession[]): number {
  if (sessions.length === 0) return 0;
  return Math.max(...sessions.map((s) => (s.endMs - s.startMs) / MS_PER_HOUR));
}

export function countSessionsOverThreshold(sessions: WorkSession[], thresholdHours: number): number {
  return sessions.filter((s) => (s.endMs - s.startMs) / MS_PER_HOUR >= thresholdHours).length;
}

export interface WorkSummary {
  totalHoursInWindow: number;
  longestSessionHours: number;
  sessionCount: number;
}

export class MoriBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async summarizeSessions(sessions: WorkSession[], windowStartMs: number, windowEndMs: number): Promise<WorkSummary> {
    await this.enforcePermission('read:work-sessions');

    const summary: WorkSummary = {
      totalHoursInWindow: computeWeeklyTotal(sessions, windowStartMs, windowEndMs),
      longestSessionHours: computeLongestSession(sessions),
      sessionCount: sessions.length,
    };

    await this.createDecision(
      { sessionCount: sessions.length },
      { totalHoursInWindow: summary.totalHoursInWindow },
      'mori-summary-v1',
    );

    return summary;
  }
}
