/**
 * platform/aegis-swarm/src/employees/api-governor.ts
 *
 * E-26 — API Governor.
 *
 * Real usage-budget enforcement: turn count, token count, session
 * duration, all checked against real, configurable limits. The exact
 * "no runaway philosophical discussion" governor requested — a real
 * hard stop, not a suggestion. Verified against real within-limit and
 * over-limit cases before implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface UsageState {
  turnCount: number;
  tokenCount: number;
  sessionDurationMs: number;
}

export interface UsageLimits {
  maxTurns: number;
  maxTokens: number;
  maxSessionDurationMs: number;
}

export interface UsageCheck {
  allowed: boolean;
  reasons: string[];
}

export function checkUsage(state: UsageState, limits: UsageLimits): UsageCheck {
  const reasons: string[] = [];
  if (state.turnCount >= limits.maxTurns) reasons.push(`Turn limit reached: ${state.turnCount}/${limits.maxTurns}`);
  if (state.tokenCount >= limits.maxTokens) reasons.push(`Token limit reached: ${state.tokenCount}/${limits.maxTokens}`);
  if (state.sessionDurationMs >= limits.maxSessionDurationMs) {
    reasons.push(`Session duration limit reached: ${state.sessionDurationMs}ms/${limits.maxSessionDurationMs}ms`);
  }
  return { allowed: reasons.length === 0, reasons };
}

export class ApiGovernorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async checkSession(state: UsageState, limits: UsageLimits): Promise<UsageCheck> {
    await this.enforcePermission('read:session-usage');

    const check = checkUsage(state, limits);

    await this.createDecision({ state }, { allowed: check.allowed, reasonCount: check.reasons.length }, 'api-governor-v1');

    if (!check.allowed) {
      await this.signalSwarm('employee.usage_limit_exceeded', { botId: this.botId, reasons: check.reasons });
    }

    return check;
  }
}
