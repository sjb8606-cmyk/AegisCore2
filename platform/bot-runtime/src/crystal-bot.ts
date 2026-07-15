/**
 * platform/bot-runtime/src/crystal-bot.ts
 *
 * Base class every AegisSwarm bot extends. A loaded BotSpecification
 * (from @platform/bot-registry) describes WHAT a bot is allowed to do;
 * this class is HOW a bot actually does it: permission-checked actions,
 * audited decisions with HITL gating, swarm signaling, and a bounded
 * convergence loop for iterative work.
 */

import { randomUUID } from 'crypto';
import { emit as auditEmit } from '@platform/audit';
import { getLogger } from '@platform/observability';
import { BotSpecification } from '@platform/bot-registry';
import { enforcePermissionBoundary } from './permission-boundary';
import {
  Decision,
  DecisionStatus,
  Finding,
  HarnessConfig,
  DEFAULT_HARNESS_CONFIG,
  LoopResult,
  PIScore,
  StopReason,
  SwarmSignal,
} from './types';

const SYSTEM_TENANT_ID = process.env.AEGIS_SYSTEM_TENANT_ID || 'system';

const SEVERITY_WEIGHT: Record<Finding['sev'], number> = {
  info: 1,
  warn: 5,
  crit: 15,
  block: 40,
};

class SwarmSignalBus {
  private listeners: Array<(signal: SwarmSignal) => void> = [];

  subscribe(fn: (signal: SwarmSignal) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  publish(signal: SwarmSignal): void {
    for (const listener of this.listeners) {
      listener(signal);
    }
  }
}

export const swarmSignalBus = new SwarmSignalBus();

export abstract class CrystalBot {
  protected readonly spec: BotSpecification;
  protected readonly logger: ReturnType<typeof getLogger>;

  constructor(spec: BotSpecification) {
    this.spec = spec;
    this.logger = getLogger(`bot:${spec.proposedBotId}`);
  }

  get botId(): string {
    return this.spec.proposedBotId;
  }

  get role(): string {
    return this.spec.role;
  }

  protected async enforcePermission(action: string, context?: Record<string, unknown>): Promise<void> {
    await enforcePermissionBoundary(this.spec, action, context);
  }

  protected async createDecision(input: unknown, output: unknown, rulesHash: string): Promise<Decision> {
    const status: DecisionStatus =
      this.spec.hitlClassification === 'Synchronous Gate' ? 'pending_approval' : 'logged';

    const decision: Decision = {
      id: randomUUID(),
      botId: this.botId,
      status,
      input,
      output,
      rulesHash,
      timestamp: new Date().toISOString(),
    };

    await auditEmit({
      tenantId: SYSTEM_TENANT_ID,
      actorId: this.botId,
      actorType: 'service',
      action: 'bot.decision_recorded',
      outcome: 'success',
      resource: 'bot_decision',
      resourceId: decision.id,
      description: `${this.botId} recorded a decision (${status})`,
      metadata: { hitlClassification: this.spec.hitlClassification, rulesHash },
    });

    if (status === 'pending_approval') {
      this.logger.warn({ decisionId: decision.id }, 'Decision requires human approval before acting');
    }

    return decision;
  }

  protected async signalSwarm(type: string, payload: unknown): Promise<void> {
    const signal: SwarmSignal = {
      type,
      fromBotId: this.botId,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.logger.info({ type, payload }, 'Signaling swarm');
    swarmSignalBus.publish(signal);
  }

  protected computePI(findings: Finding[], prev = 0): PIScore {
    if (findings.length === 0) {
      return { curr: 100, prev, delta: 100 - prev };
    }
    const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.sev], 0);
    const curr = Math.max(0, 100 - penalty);
    return { curr, prev, delta: curr - prev };
  }

  protected async runConvergenceLoop<T extends { findings: Finding[] }>(
    fn: (loopNumber: number) => Promise<T>,
    config: HarnessConfig = DEFAULT_HARNESS_CONFIG,
  ): Promise<LoopResult<T>> {
    const history: LoopResult<T>['history'] = [];
    let prevPI = 0;
    let stagLoops = 0;
    let stopReason: StopReason = 'stop_budget';

    for (let loop = 1; loop <= config.max_loops; loop++) {
      const result = await fn(loop);
      const pi = this.computePI(result.findings, prevPI);
      history.push({ loop, pi, result });

      if (pi.curr >= config.target_pi) {
        stopReason = 'stop_perfected';
        prevPI = pi.curr;
        break;
      }

      if (Math.abs(pi.delta) < config.converge_thresh) {
        stagLoops++;
      } else {
        stagLoops = 0;
      }

      prevPI = pi.curr;

      if (stagLoops >= 2) {
        stopReason = 'stop_converged';
        break;
      }
    }

    const finalPI = history[history.length - 1]?.pi ?? { curr: 0, prev: 0, delta: 0 };
    this.logger.info({ loops: history.length, stopReason, finalPI }, 'Convergence loop finished');

    return { loops: history.length, finalPI, stopReason, history };
  }
}
