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
import { saveDecision, getDecision } from './decision-store';
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

// Conversational layer must never become a way around HITL approval.
// Matched against every question before anything else runs — this is
// deliberately a hard, unconditional refusal, not a status-dependent
// check, so it can't be reasoned around by rephrasing.
const APPROVAL_BYPASS_PATTERNS: RegExp[] = [
  /\bapprove\b/i,
  /\breject\b/i,
  /\bmark\s+(it\s+)?(as\s+)?(approved|passed|rejected|failed)\b/i,
  /\boverrid(e|ing)\b/i,
  /\bforce\s+(pass|approve|it)\b/i,
  /\bskip\s+(the\s+)?(review|approval|gate)\b/i,
  /\bjust\s+(approve|pass|allow|let\s+it\s+through)\b/i,
  /\bsign\s*off\b/i,
];

export interface ExplainResult {
  decisionId: string;
  answer: string;
  refused: boolean;
}

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

    // Persist so a later explainDecision() call — in this process or a
    // fresh one — can answer grounded in what actually happened. Never
    // let a storage hiccup break the bot's real work; log and move on,
    // same never-throw philosophy as the audit emitter.
    try {
      await saveDecision(decision);
    } catch (err) {
      this.logger.error({ err, decisionId: decision.id }, 'Failed to persist decision for later explainDecision() lookup');
    }

    return decision;
  }

  /**
   * Answers a question about one of this bot's own past decisions,
   * grounded strictly in what was actually stored — never invents an
   * answer disconnected from real findings. Read-only: cannot change a
   * decision's status, and can never be used to approve, reject, or
   * otherwise bypass a Synchronous Gate. That refusal is unconditional
   * and checked before anything else, regardless of the decision's
   * current status.
   */
  async explainDecision(decisionId: string, question: string): Promise<ExplainResult> {
    const isBypassAttempt = APPROVAL_BYPASS_PATTERNS.some((pattern) => pattern.test(question));

    if (isBypassAttempt) {
      await auditEmit({
        tenantId: SYSTEM_TENANT_ID,
        actorId: this.botId,
        actorType: 'service',
        action: 'bot.decision_explained',
        outcome: 'failure',
        resource: 'bot_decision',
        resourceId: decisionId,
        description: `${this.botId} refused a conversational request that looked like an approval/status-change attempt`,
        metadata: { refused: true },
      });
      return {
        decisionId,
        refused: true,
        answer:
          "I can explain what I found, but I can't approve, reject, or otherwise change a decision's status through conversation — that has to go through the actual human approval step.",
      };
    }

    const decision = await getDecision(decisionId);

    if (!decision || decision.botId !== this.botId) {
      return {
        decisionId,
        refused: false,
        answer: `I don't have a stored decision with id "${decisionId}" for ${this.botId}.`,
      };
    }

    const answer = this.formatDecisionAnswer(decision, question);

    await auditEmit({
      tenantId: SYSTEM_TENANT_ID,
      actorId: this.botId,
      actorType: 'service',
      action: 'bot.decision_explained',
      outcome: 'success',
      resource: 'bot_decision',
      resourceId: decisionId,
      description: `${this.botId} answered a question about decision ${decisionId}`,
    });

    return { decisionId, refused: false, answer };
  }

  /**
   * Deterministic, template-based formatting over the decision's real
   * stored input/output — no free-text generation, so there's nothing
   * for the bot to invent or hallucinate. Subclasses may override for
   * bot-specific phrasing, but must keep grounding in `decision.output`.
   */
  protected formatDecisionAnswer(decision: Decision, _question: string): string {
    const persona = this.spec.persona;
    const speaker = persona ? `${persona.name}` : this.botId;
    const statusLine =
      decision.status === 'pending_approval'
        ? "This decision is still awaiting human approval — I haven't acted on it."
        : `Status: ${decision.status}.`;

    return [
      `${speaker} here. On ${decision.timestamp}, I recorded this based on: ${JSON.stringify(decision.input)}.`,
      `What I found: ${JSON.stringify(decision.output)}.`,
      statusLine,
    ].join(' ');
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
